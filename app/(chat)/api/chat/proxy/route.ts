import { NextResponse } from "next/server";
import { LanguageModel, smoothStream, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import logger from "@/lib/utils/logger";
import { createCompatibleDataStream } from "@/lib/utils/messages";
import { messageSchema, ValidatedMessage } from "@/lib/utils/messages";
import { handleContinuation } from "@/lib/utils/chat";

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
  options: z
    .object({
      parentMessageId: z.string().optional(),
      skipUserMessage: z.boolean().optional(),
      isBranch: z.boolean().optional(),
    })
    .optional(),
  seed: z.union([z.string(), z.number()]).optional(),
  // Add continuation parameters
  continueMessageId: z.string().optional(),
  originalContent: z.string().optional(),
  isContinuation: z.boolean().optional(),
  continuationPreferences: z
    .object({
      seamless: z.boolean().optional(),
      avoidTransitions: z.boolean().optional(),
      maintainTone: z.boolean().optional(),
      noRepetition: z.boolean().optional(),
    })
    .optional(),
});

// Error response type
interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Creates a standardized error response
 */
function createErrorResponse(
  error: string,
  details?: unknown,
  status = 500
): Response {
  logger.error(`Proxy error: ${error}`, undefined, {
    module: "proxy",
    context: { details },
  });

  return NextResponse.json({ error, details } as ErrorResponse, { status });
}

/**
 * Creates a provider instance
 */
function createProvider() {
  // Get API key and base URL from environment variables
  const provider = process.env.NEXT_PUBLIC_CHAT_PROVIDER;
  const apiKey = process.env.NEXT_PUBLIC_CHAT_API_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_CHAT_BASE_URL;

  if (!apiKey) {
    throw new Error("API key not found");
  }

  if (!baseUrl) {
    throw new Error("Base URL not found");
  }

  logger.debug("Creating provider", {
    module: "proxy",
    context: { provider, baseUrl },
  });

  return createOpenAICompatible({
    name: provider ?? "openai compatible",
    apiKey,
    baseURL: baseUrl,
  });
}

// Define additional properties for messages in this route
export interface RouteValidatedMessage extends ValidatedMessage {
  name?: string;
}

// Create a properly typed message based on the role
function createTypedMessage(msg: RouteValidatedMessage) {
  const validRoles = ["user", "assistant", "system"] as const;
  const role = validRoles.includes(msg.role as any) ? msg.role : "assistant";
  return {
    role,
    content: msg.content,
  } as const;
}

// proxy using Vercel AI SDK streamText
export async function POST(req: Request): Promise<Response> {
  try {
    // Create the provider
    const provider = createProvider();

    // Parse and validate the request body
    let body;
    try {
      const rawBody = await req.json();

      // Validate the request body against the schema
      const validationResult = RequestSchema.safeParse(rawBody);

      if (!validationResult.success) {
        logger.warn("Validation error in request", {
          module: "proxy",
          context: { error: validationResult.error.format() },
        });

        return createErrorResponse(
          "Invalid request body",
          validationResult.error.format(),
          400
        );
      }

      body = validationResult.data;
    } catch (error) {
      return createErrorResponse(
        "Failed to parse request body",
        error instanceof Error ? error.message : String(error),
        400
      );
    }

    // Extract required parameters
    const {
      messages,
      model,
      id,
      stream = true,
      streamProtocol = "text",
      continueMessageId,
      originalContent,
      isContinuation,
    } = body;

    logger.info(`Processing request for model: ${model}, chat: ${id}`, {
      module: "proxy",
      context: {
        protocol: streamProtocol,
        stream,
        isContinuation: !!isContinuation,
        hasContinueMessageId: !!continueMessageId,
      },
    });

    logger.debug(`Stream protocol: ${streamProtocol}`, { module: "proxy" });

    // Process messages based on options
    let processedMessages = processMessages(messages, body.options);

    // Handle continuation if needed
    if (isContinuation && continueMessageId && originalContent) {
      processedMessages = handleContinuation(
        processedMessages,
        continueMessageId,
        originalContent
      );
    }

    // Add detailed logging of processed messages
    logger.debug(`Processed messages (${processedMessages.length}):`, {
      module: "proxy",
    });

    processedMessages.forEach((msg: RouteValidatedMessage, idx: number) => {
      logger.debug(
        `[${idx}] ${msg.role}: ${msg.content.substring(0, 50)}${
          msg.content.length > 50 ? "..." : ""
        }`,
        { module: "proxy" }
      );
    });

    const coreMessages = processedMessages.map(createTypedMessage);

    // Log final messages being sent to LLM
    logger.info(`Sending ${coreMessages.length} messages to ${model}`, {
      module: "proxy",
    });

    // Safety check - ensure we're not sending empty messages
    const validMessages = coreMessages.filter(
      (msg: { content: string }) => msg.content && msg.content.trim() !== ""
    );

    if (validMessages.length !== coreMessages.length) {
      logger.warn(
        `WARNING: Filtered out ${
          coreMessages.length - validMessages.length
        } empty messages`,
        { module: "proxy" }
      );
    }

    if (validMessages.length === 0) {
      // If we have no valid messages, add a default system prompt
      validMessages.push({
        role: "system",
        content:
          "You are a helpful AI assistant. Please provide a thoughtful response.",
      } as const);

      logger.info(
        "Added default system message because all messages were empty",
        {
          module: "proxy",
        }
      );
    }

    // Create a streamText result using the OpenAI-compatible provider
    const result = streamText({
      model: provider(model) as LanguageModel,
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
      seed: body.seed ? Number(body.seed) : undefined,
      experimental_transform: smoothStream(),
    });

    // Return a data stream response that works with the useChat hook
    // Respect the requested protocol format
    if (streamProtocol === "text") {
      logger.debug("Returning text stream", { module: "proxy" });
      return result.toTextStreamResponse();
    } else {
      // Default to data format
      logger.debug("Using data stream protocol to return response", {
        module: "proxy",
      });

      // Get the data stream response
      const dataStreamResponse = result.toDataStreamResponse();

      // Return transformed stream
      return createCompatibleDataStream(dataStreamResponse);
    }
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : String(error)
    );
  }
}

// Helper function to process messages and handle branch logic
function processMessages(
  messages: RouteValidatedMessage[],
  options?: {
    parentMessageId?: string;
    skipUserMessage?: boolean;
    isBranch?: boolean;
  }
) {
  // Log the original message count and options
  logger.debug(`Processing ${messages.length} messages with options:`, {
    module: "proxy",
    context: options,
  });

  // If this is a branch (retry) request with skipUserMessage flag, we need to filter out
  // the old assistant messages when the parent message ID matches
  if (
    options?.skipUserMessage &&
    options?.parentMessageId &&
    options?.isBranch
  ) {
    logger.info("BRANCH REQUEST DETECTED - Processing branch request", {
      module: "proxy",
    });
    logger.debug("Looking for parent message with ID:", {
      module: "proxy",
      context: { parentId: options.parentMessageId },
    });

    // Log all message IDs to help debugging
    logger.debug("Available message IDs:", {
      module: "proxy",
      context: {
        messageIds: messages.map((m) => `${m.id} (${m.role})`),
      },
    });

    // First try: Find the exact parent message by ID
    let parentIndex = messages.findIndex(
      (msg) => msg.id === options.parentMessageId
    );

    // Second try: Try a more flexible string comparison
    if (parentIndex === -1) {
      parentIndex = messages.findIndex(
        (msg) => String(msg.id) === String(options.parentMessageId)
      );
    }

    // Third try: If we still can't find the parent, just keep the conversation up to the last user message
    if (parentIndex === -1) {
      logger.info("Parent not found by ID, looking for last user message", {
        module: "proxy",
      });

      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          parentIndex = i;
          logger.info(`Using fallback: last user message at index ${i}`, {
            module: "proxy",
          });
          break;
        }
      }
    }

    logger.info(`Parent message found at index: ${parentIndex}`, {
      module: "proxy",
    });

    if (parentIndex >= 0) {
      // Keep messages up to and including the parent (usually a user message)
      // This effectively removes any previous assistant responses to this user message
      const filteredMessages = messages.slice(0, parentIndex + 1);
      logger.info(
        `Filtered to ${filteredMessages.length} messages for branching`,
        { module: "proxy" }
      );

      // Check if we already have a system message
      const hasSystemMessage = filteredMessages.some(
        (msg) => msg.role === "system"
      );

      // For branching, ensure there's a system message that instructs the AI
      // to generate a fresh response
      if (!hasSystemMessage) {
        logger.info("Adding system message for branch request", {
          module: "proxy",
        });

        filteredMessages.unshift({
          id: "system-message",
          role: "system",
          content:
            "You are a helpful AI assistant. Please provide a new response to the user's message in the same general format and style as a typical assistant response. Do not offer multiple options or explain your thinking process - just respond directly to the user as if this was your first response to them. This is a branch in the conversation where we want a different, but similarly formatted response.",
          createdAt: new Date().toISOString(),
        } as RouteValidatedMessage);
      }

      // Make sure we have at least one instruction for the model in case of a very short conversation
      // For very short conversations, we might need to add a system message
      if (
        filteredMessages.length === 1 &&
        filteredMessages[0].role === "user"
      ) {
        logger.info(
          "Adding system instruction for single-message conversation",
          { module: "proxy" }
        );

        filteredMessages.unshift({
          id: "system-message",
          role: "system",
          content:
            "You are a helpful AI assistant. Please respond to the user's message.",
          createdAt: new Date().toISOString(),
        } as RouteValidatedMessage);
      }

      // Take a deep copy to avoid reference issues
      return JSON.parse(JSON.stringify(filteredMessages));
    } else {
      logger.warn(
        "WARNING: Parent message not found in the message array. Using all messages.",
        { module: "proxy" }
      );
    }
  }

  // Return the filtered ValidatedMessage array (or original if no filtering occurred)
  return messages;
}
