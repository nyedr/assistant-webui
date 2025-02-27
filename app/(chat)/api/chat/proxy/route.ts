import { NextResponse } from "next/server";
import { LanguageModel, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { messageSchema } from "../messages/route";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

// Define the request schema for validation
const RequestSchema = z.object({
  messages: z.array(messageSchema),
  model: z.string(),
  id: z.string().optional(),
  stream: z.boolean().optional().default(true),
  streamProtocol: z.enum(["text", "data"]).optional().default("text"),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  reasoning: z
    .object({
      effort: z.enum(["low", "medium", "high"]).optional(),
      exclude: z.boolean().optional(),
    })
    .optional(),
});

// Error response type
interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Type for our validated message from the schema
type ValidatedMessage = z.infer<typeof messageSchema>;

// OpenRouter proxy using Vercel AI SDK streamText
export async function POST(req: Request): Promise<Response> {
  try {
    // Get API key and base URL from environment variables
    const provider = process.env.NEXT_PUBLIC_CHAT_PROVIDER;
    const apiKey = process.env.NEXT_PUBLIC_CHAT_API_KEY;
    const baseUrl = process.env.NEXT_PUBLIC_CHAT_BASE_URL;

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not found" } as ErrorResponse,
        { status: 500 }
      );
    }

    if (!baseUrl) {
      return NextResponse.json(
        { error: "Base URL not found" } as ErrorResponse,
        { status: 500 }
      );
    }

    // Parse and validate the request body
    let body;
    try {
      const rawBody = await req.json();

      // Validate the request body against the schema
      const validationResult = RequestSchema.safeParse(rawBody);

      if (!validationResult.success) {
        console.error("Validation error:", validationResult.error);
        return NextResponse.json(
          {
            error: "Invalid request body",
            details: validationResult.error.format(),
          } as ErrorResponse,
          { status: 400 }
        );
      }

      body = validationResult.data;
    } catch (error) {
      return NextResponse.json(
        {
          error: "Failed to parse request body",
          details: error instanceof Error ? error.message : String(error),
        } as ErrorResponse,
        { status: 400 }
      );
    }

    // Extract required parameters
    const {
      messages,
      model,
      id,
      stream = true,
      streamProtocol = "text",
    } = body;

    console.log(`Processing request for model: ${model}, chat: ${id}`);
    console.log(`Using protocol: ${streamProtocol}`);

    // Create an OpenAI-compatible provider pointed to OpenRouter
    const openRouterProvider = createOpenAICompatible({
      name: provider ?? "openai compatible",
      apiKey,
      baseURL: baseUrl,
    });

    // Handle streaming response with streamText
    if (stream) {
      console.log(`Stream protocol: ${streamProtocol}`);

      // Convert messages to CoreMessage format for the AI SDK
      const coreMessages = messages.map((msg: ValidatedMessage) => {
        // Create a properly typed message based on the role
        if (msg.role === "user") {
          return {
            role: "user",
            content: msg.content,
            ...(msg.name && { name: msg.name }),
          } as const;
        } else if (msg.role === "assistant") {
          return {
            role: "assistant",
            content: msg.content,
          } as const;
        } else if (msg.role === "system") {
          return {
            role: "system",
            content: msg.content,
          } as const;
        } else {
          // For "data" role, convert to assistant as it's closest match
          return {
            role: "assistant",
            content: msg.content,
          } as const;
        }
      });

      // Create a streamText result using the OpenAI-compatible provider
      const result = streamText({
        model: openRouterProvider(model) as LanguageModel,
        messages: coreMessages,
        // Pass through any additional parameters provided in the request
        ...(body.temperature && { temperature: body.temperature }),
        ...(body.max_tokens && { maxTokens: body.max_tokens }),
        ...(body.top_p && { topP: body.top_p }),
        ...(body.frequency_penalty && {
          frequencyPenalty: body.frequency_penalty,
        }),
        ...(body.presence_penalty && {
          presencePenalty: body.presence_penalty,
        }),
        ...(body.reasoning && { reasoning: body.reasoning }),
      });

      // Return a data stream response that works with the useChat hook
      // Respect the requested protocol format
      if (streamProtocol === "text") {
        return result.toTextStreamResponse();
      } else {
        // Default to data format
        return result.toDataStreamResponse();
      }
    } else {
      // For non-streaming responses, use the OpenAI SDK directly
      const { OpenAI } = await import("openai");

      const openai = new OpenAI({
        apiKey,
        baseURL: baseUrl,
      });

      // Convert messages to the format expected by OpenAI
      const openaiMessages: ChatCompletionMessageParam[] = messages.map(
        (msg: ValidatedMessage) => ({
          role: msg.role === "data" ? "assistant" : msg.role, // OpenAI doesn't support "data" role
          content: msg.content,
          ...(msg.name && { name: msg.name }),
        })
      );

      const response = await openai.chat.completions.create({
        model,
        messages: openaiMessages,
        stream: false,
        // Pass through any additional parameters
        ...(body.reasoning && { reasoning: body.reasoning }),
        ...(body.temperature && { temperature: body.temperature }),
        ...(body.max_tokens && { max_tokens: body.max_tokens }),
        ...(body.top_p && { top_p: body.top_p }),
        ...(body.frequency_penalty && {
          frequency_penalty: body.frequency_penalty,
        }),
        ...(body.presence_penalty && {
          presence_penalty: body.presence_penalty,
        }),
      });

      return NextResponse.json(response);
    }
  } catch (error) {
    console.error("Proxy error:", error);

    // Return a structured error response
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      } as ErrorResponse,
      { status: 500 }
    );
  }
}
