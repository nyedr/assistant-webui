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
  options: z
    .object({
      parentMessageId: z.string().optional(),
      skipUserMessage: z.boolean().optional(),
      isBranch: z.boolean().optional(),
    })
    .optional(),
  seed: z.union([z.string(), z.number()]).optional(),
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
      const processedMessages = processMessages(messages, body.options);

      // Add detailed logging of processed messages
      console.log(`Processed messages (${processedMessages.length}):`);
      processedMessages.forEach((msg: ValidatedMessage, idx: number) => {
        console.log(
          `[${idx}] ${msg.role}: ${msg.content.substring(0, 50)}${
            msg.content.length > 50 ? "..." : ""
          }`
        );
      });

      const coreMessages = processedMessages.map((msg: ValidatedMessage) => {
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

      // Log final messages being sent to LLM
      console.log(`Sending ${coreMessages.length} messages to ${model}:`);
      coreMessages.forEach((msg: any, idx: number) => {
        console.log(
          `[${idx}] ${msg.role}: ${msg.content.substring(0, 50)}${
            msg.content.length > 50 ? "..." : ""
          }`
        );
      });

      // Safety check - ensure we're not sending empty messages
      const validMessages = coreMessages.filter(
        (msg: { content: string }) => msg.content && msg.content.trim() !== ""
      );
      if (validMessages.length !== coreMessages.length) {
        console.log(
          `WARNING: Filtered out ${
            coreMessages.length - validMessages.length
          } empty messages`
        );
      }

      if (validMessages.length === 0) {
        // If we have no valid messages, add a default system prompt
        validMessages.push({
          role: "system",
          content:
            "You are a helpful AI assistant. Please provide a thoughtful response.",
        } as const);
        console.log(
          "Added default system message because all messages were empty"
        );
      }

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
        seed: body.seed ? Number(body.seed) : undefined,
      });

      // Return a data stream response that works with the useChat hook
      // Respect the requested protocol format
      if (streamProtocol === "text") {
        return result.toTextStreamResponse();
      } else {
        // Default to data format
        console.log("Using data stream protocol to return response");

        // Get the data stream response
        const dataStreamResponse = result.toDataStreamResponse();

        // Clone the response to inspect its content without consuming it
        const responseClone = dataStreamResponse.clone();

        // Log the response headers
        console.log(
          "Data Stream Response Headers:",
          Object.fromEntries([...responseClone.headers.entries()])
        );

        // Attempt to log a sample of the response body if possible
        responseClone.body
          ?.getReader()
          .read()
          .then(({ value }) => {
            if (value) {
              const sampleText = new TextDecoder().decode(value).slice(0, 200);
              console.log("Data Stream Sample (first 200 chars):", sampleText);
            }
          })
          .catch((err) => {
            console.error("Error reading response sample:", err);
          });

        // Convert the response to a compatible format for our client
        return createCompatibleDataStream(dataStreamResponse);
      }
    } else {
      // For non-streaming responses, use the OpenAI SDK directly
      const { OpenAI } = await import("openai");

      const openai = new OpenAI({
        apiKey,
        baseURL: baseUrl,
      });

      // Convert messages to the format expected by OpenAI using our helper function
      const processedMessages = processMessages(messages, body.options);

      // Then convert to OpenAI format
      const openaiMessages: ChatCompletionMessageParam[] =
        processedMessages.map((msg: ValidatedMessage) => ({
          role: msg.role === "data" ? "assistant" : msg.role, // OpenAI doesn't support "data" role
          content: msg.content,
          ...(msg.name && { name: msg.name }),
        }));

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

// Helper function to process messages and handle branch logic
function processMessages(
  messages: ValidatedMessage[],
  options?: {
    parentMessageId?: string;
    skipUserMessage?: boolean;
    isBranch?: boolean;
  }
) {
  // Log the original message count and options
  console.log(`Processing ${messages.length} messages with options:`, options);

  // Check for duplicate user messages with the same content and remove them
  const uniqueMessages = removeDuplicateUserMessages(messages);
  if (uniqueMessages.length !== messages.length) {
    console.log(
      `Removed ${
        messages.length - uniqueMessages.length
      } duplicate user messages`
    );
    messages = uniqueMessages;
  }

  // If this is a branch (retry) request with skipUserMessage flag, we need to filter out
  // the old assistant messages when the parent message ID matches
  if (
    options?.skipUserMessage &&
    options?.parentMessageId &&
    options?.isBranch
  ) {
    console.log("BRANCH REQUEST DETECTED - Processing branch request");
    console.log("Looking for parent message with ID:", options.parentMessageId);

    // Log all message IDs to help debugging
    console.log(
      "Available message IDs:",
      messages.map((m) => `${m.id} (${m.role})`).join(", ")
    );

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
      console.log("Parent not found by ID, looking for last user message");
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          parentIndex = i;
          console.log(`Using fallback: last user message at index ${i}`);
          break;
        }
      }
    }

    console.log(`Parent message found at index: ${parentIndex}`);

    if (parentIndex >= 0) {
      // Keep messages up to and including the parent (usually a user message)
      // This effectively removes any previous assistant responses to this user message
      const filteredMessages = messages.slice(0, parentIndex + 1);
      console.log(
        `Filtered to ${filteredMessages.length} messages for branching`
      );

      // Check if we already have a system message
      const hasSystemMessage = filteredMessages.some(
        (msg) => msg.role === "system"
      );

      // For branching, ensure there's a system message that instructs the AI
      // to generate a fresh response
      if (!hasSystemMessage) {
        console.log("Adding system message for branch request");
        filteredMessages.unshift({
          id: "system-message",
          role: "system",
          content:
            "You are a helpful AI assistant. Please provide a new response to the user's message in the same general format and style as a typical assistant response. Do not offer multiple options or explain your thinking process - just respond directly to the user as if this was your first response to them. This is a branch in the conversation where we want a different, but similarly formatted response.",
          createdAt: new Date().toISOString(),
        } as ValidatedMessage);
      }

      // Make sure we have at least one instruction for the model in case of a very short conversation
      // For very short conversations, we might need to add a system message
      if (
        filteredMessages.length === 1 &&
        filteredMessages[0].role === "user"
      ) {
        console.log(
          "Adding system instruction for single-message conversation"
        );
        filteredMessages.unshift({
          id: "system-message",
          role: "system",
          content:
            "You are a helpful AI assistant. Please respond to the user's message.",
          createdAt: new Date().toISOString(),
        } as ValidatedMessage);
      }

      // Take a deep copy to avoid reference issues
      return JSON.parse(JSON.stringify(filteredMessages));
    } else {
      console.log(
        "WARNING: Parent message not found in the message array. Using all messages."
      );
    }
  }

  // Return the filtered ValidatedMessage array (or original if no filtering occurred)
  return messages;
}

// Deduplicate user messages with the same content (keeps the one with children_ids)
function removeDuplicateUserMessages(
  messages: ValidatedMessage[]
): ValidatedMessage[] {
  const seen = new Map<string, ValidatedMessage>();
  const contentMap = new Map<string, ValidatedMessage[]>();

  // Group user messages by content
  messages
    .filter((msg) => msg.role === "user")
    .forEach((msg) => {
      if (!contentMap.has(msg.content)) {
        contentMap.set(msg.content, []);
      }
      contentMap.get(msg.content)!.push(msg);
    });

  // For each content, keep the message with children_ids if possible
  const toRemove = new Set<string>();

  contentMap.forEach((msgs, content) => {
    if (msgs.length > 1) {
      console.log(
        `Found ${msgs.length} user messages with content: "${content.substring(
          0,
          30
        )}..."`
      );

      // Prefer to keep messages with children_ids
      const withChildren = msgs.filter(
        (m) => m.children_ids && m.children_ids.length > 0
      );

      if (withChildren.length > 0) {
        // Keep the one with most children
        const keeper = withChildren.sort(
          (a, b) =>
            (b.children_ids?.length || 0) - (a.children_ids?.length || 0)
        )[0];

        // Mark others for removal
        msgs.forEach((m) => {
          if (m.id !== keeper.id) {
            toRemove.add(m.id);
            console.log(`Marking duplicate user message for removal: ${m.id}`);
          }
        });
      } else {
        // If none have children, keep the most recent one
        const keeper = msgs.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
          const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
          return dateB.getTime() - dateA.getTime();
        })[0];

        msgs.forEach((m) => {
          if (m.id !== keeper.id) {
            toRemove.add(m.id);
            console.log(`Marking duplicate user message for removal: ${m.id}`);
          }
        });
      }
    }
  });

  // Filter out the messages marked for removal
  return messages.filter((msg) => !toRemove.has(msg.id));
}

// Add a utility function to convert custom stream format to format expected by streamChatMessage
async function createCompatibleDataStream(
  response: Response
): Promise<Response> {
  // Create a TransformStream to modify the data
  const { readable, writable } = new TransformStream();

  // Clone the response we're going to transform
  const clonedResponse = response.clone();

  console.log("Creating compatible data stream");
  console.log(
    "Original response headers:",
    Object.fromEntries([...clonedResponse.headers.entries()])
  );

  if (!clonedResponse.body) {
    console.error("Response body is null");
    return response; // Return original if no body
  }

  // Process the stream
  const reader = clonedResponse.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const writer = writable.getWriter();

  // Process chunks
  (async () => {
    try {
      let buffer = "";
      let done = false;

      while (!done) {
        const result = await reader.read();
        done = result.done;

        if (done) {
          console.log("Stream processing complete");
          await writer.close();
          break;
        }

        // Decode the chunk and add to buffer
        buffer += decoder.decode(result.value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep the last incomplete line in the buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          console.log("Original line:", line);

          // If it's already in data: format, pass it through
          if (line.startsWith("data: ")) {
            await writer.write(encoder.encode(line + "\n\n"));
            continue;
          }

          // Convert custom format (f:, 0:, e:, d:) to data: format
          const match = line.match(/^([a-z]):(.*)/);

          if (match) {
            const [, prefix, content] = match;
            let jsonObj = {};

            try {
              // For text content (0:), we need special handling to extract the actual text
              if (prefix === "0") {
                // Try to extract the actual string content directly
                let actualText = "";

                try {
                  // First, try treating it as a JSON string
                  actualText = JSON.parse(content);
                  if (typeof actualText !== "string") {
                    // If the parsed content isn't a string, fallback to regex extraction
                    const extractMatch = content.match(/^"(.*?)"$/);
                    if (extractMatch) {
                      actualText = extractMatch[1].replace(/\\(.)/g, "$1"); // Handle escaped chars
                    } else {
                      actualText = content; // Last resort: use content as-is
                    }
                  }
                } catch (parseErr) {
                  // If JSON parsing fails, try regex extraction
                  const extractMatch = content.match(/^"(.*?)"$/);
                  if (extractMatch) {
                    actualText = extractMatch[1].replace(/\\(.)/g, "$1"); // Handle escaped chars
                  } else {
                    actualText = content; // Last resort: use content as-is
                  }
                }

                // Create the text object with the extracted content
                jsonObj = {
                  type: "text",
                  value: actualText, // Use the actual extracted text
                };

                console.log("Extracted text content:", actualText);
              } else {
                // For other types, parse the content as JSON object
                const parsedContent = JSON.parse(content);

                // Map to the expected format based on prefix
                if (prefix === "f") {
                  // Start message
                  jsonObj = {
                    type: "start_step",
                    messageId: parsedContent.messageId || null,
                  };
                } else if (prefix === "e") {
                  // End message
                  jsonObj = {
                    type: "finish_step",
                    finishReason: parsedContent.finishReason || "stop",
                  };
                } else if (prefix === "d") {
                  // Done message
                  jsonObj = {
                    type: "finish_message",
                    finishReason: parsedContent.finishReason || "stop",
                    ...(parsedContent.usage && { usage: parsedContent.usage }),
                  };
                }
              }

              // Encode to the expected data: format
              const transformedLine = `data: ${JSON.stringify(jsonObj)}\n\n`;
              console.log("Transformed to:", transformedLine);
              await writer.write(encoder.encode(transformedLine));
            } catch (err) {
              console.error(
                `Error transforming stream line (${prefix}:${content}):`,
                err
              );

              // Fallback: If we can't parse JSON, treat as plain text for 0: prefix
              if (prefix === "0") {
                try {
                  // Handle case where the content might not be properly JSON quoted
                  const textContent = content.trim();
                  const jsonObj = {
                    type: "text",
                    value:
                      textContent.startsWith('"') && textContent.endsWith('"')
                        ? JSON.parse(textContent) // It's a JSON string
                        : textContent, // It's plain text
                  };

                  const transformedLine = `data: ${JSON.stringify(
                    jsonObj
                  )}\n\n`;
                  console.log("Fallback transformed to:", transformedLine);
                  await writer.write(encoder.encode(transformedLine));
                } catch (innerErr) {
                  console.error("Error in fallback text parsing:", innerErr);
                  // Last resort: pass through with minimal transformation
                  await writer.write(
                    encoder.encode(
                      `data: {"type":"text","value":${content}}\n\n`
                    )
                  );
                }
              } else {
                // For non-text formats, create a minimal compatible response
                let fallbackObj = {};

                if (prefix === "f") {
                  fallbackObj = { type: "start_step" };
                } else if (prefix === "e") {
                  fallbackObj = { type: "finish_step", finishReason: "stop" };
                } else if (prefix === "d") {
                  fallbackObj = {
                    type: "finish_message",
                    finishReason: "stop",
                  };
                }

                await writer.write(
                  encoder.encode(`data: ${JSON.stringify(fallbackObj)}\n\n`)
                );
              }
            }
          } else {
            // Pass through lines that don't match our format
            // But wrap them as data: text events to ensure compatibility
            try {
              const fallbackObj = { type: "text", value: line };
              await writer.write(
                encoder.encode(`data: ${JSON.stringify(fallbackObj)}\n\n`)
              );
            } catch (err) {
              // Last resort: just pass through
              await writer.write(encoder.encode(`${line}\n`));
            }
          }
        }
      }
    } catch (err) {
      console.error("Error processing stream:", err);
      await writer.close();
    }
  })();

  // Create new response with transformed body
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
