import type { Message } from "ai";
import type { Document } from "@/lib/db/schema";
import { ValidatedMessage } from "@/app/(chat)/api/chat/messages/route";

// Extended Message type with additional properties
export interface ExtendedMessage extends Message {
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
  parts?: any[];
}

// Extended ChatRequestOptions type
export interface ExtendedChatRequestOptions {
  options?: {
    parentMessageId?: string;
    preserveMessageId?: string;
  };
}

/**
 * Removes empty or invalid messages from the response
 */
export function sanitizeResponseMessages(
  messages: Array<Message>
): Array<Message> {
  return messages.filter((message) => {
    if (message.role !== "assistant") {
      return true;
    }

    return (
      message.content.trim().length > 0 ||
      (Array.isArray(message.toolInvocations) &&
        message.toolInvocations.length > 0)
    );
  });
}

/**
 * Sanitizes messages for UI display
 */
export function sanitizeUIMessages(messages: Array<Message>): Array<Message> {
  return messages.filter((message) => {
    if (message.role !== "assistant") {
      return true;
    }

    return (
      message.content.trim().length > 0 ||
      (Array.isArray(message.toolInvocations) &&
        message.toolInvocations.length > 0)
    );
  });
}

/**
 * Returns the most recent user message from the array
 */
export function getMostRecentUserMessage(messages: Array<Message>) {
  return messages.findLast((message) => message.role === "user");
}

/**
 * Gets the timestamp for a document at a specific index
 */
export function getDocumentTimestampByIndex(
  documents: Array<Document>,
  index: number
) {
  if (!documents) return new Date();
  if (index >= documents.length) return new Date();

  return documents[index].createdAt;
}

/**
 * Find the message that a response should be to - this is the last user message in the chat
 * @param messages Array of chat messages
 * @returns Message ID of the message being responded to
 */
export function findLastUserMessageId(messages: Message[]): string | null {
  // Always start from the most recent message and work backwards
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i].id;
    }
  }
  return null;
}

/**
 * Updates the parent message's children list when a new message is generated
 * @param messages Current message array
 * @param message New message to process
 * @param preservedMessageId Optional ID of message being preserved (for retry)
 * @returns Updated messages array
 */
export function updateMessageRelationships(
  messages: Message[],
  message: ExtendedMessage,
  preservedMessageId?: string
): Message[] {
  // Create a working copy of messages that all have the extended fields
  const currentMessages = messages.map((msg) => ensureExtendedMessage(msg));

  // For a new assistant message, the parent should be the last user message
  // For a new user message, the parent should be the last assistant message if any
  let parentMessageId = message.parent_id || null;

  // If parent_id isn't set yet, find the appropriate parent
  if (!parentMessageId) {
    if (message.role === "assistant") {
      // Find the most recent user message
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        if (currentMessages[i].role === "user") {
          parentMessageId = currentMessages[i].id;
          break;
        }
      }
    } else if (message.role === "user") {
      // Find the most recent assistant message if any
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        if (currentMessages[i].role === "assistant") {
          parentMessageId = currentMessages[i].id;
          break;
        }
      }
    }
  }

  // Update the message's parent_id
  const updatedMessage = {
    ...message,
    parent_id: parentMessageId,
    children_ids: message.children_ids || [],
    // Ensure model is never null for assistant messages
    model:
      message.role === "assistant" ? message.model || "unknown" : message.model,
    parts: Array.isArray(message.parts) ? message.parts : [],
  };

  // Find the parent message and update its children_ids
  if (parentMessageId) {
    const parentIndex = currentMessages.findIndex(
      (m) => m.id === parentMessageId
    );

    if (parentIndex >= 0) {
      const parent = currentMessages[parentIndex];
      // Ensure children_ids is an array even if undefined
      const childrenIds = parent.children_ids || [];

      // Add this message to the parent's children if not already there
      if (!childrenIds.includes(message.id)) {
        currentMessages[parentIndex] = {
          ...parent,
          children_ids: [...childrenIds, message.id],
        } as Message;
      }
    }
  }

  // Replace or add the message in the array
  const messageIndex = currentMessages.findIndex((m) => m.id === message.id);
  if (messageIndex >= 0) {
    currentMessages[messageIndex] = updatedMessage as Message;
  } else {
    currentMessages.push(updatedMessage as Message);
  }

  return currentMessages as Message[];
}

/**
 * Prepares a message with proper parent-child relationships
 * @param message The message to prepare
 * @param messages The current message array to establish relationships from
 * @param selectedModelId The model ID to use
 * @returns Prepared message with relationships
 */
export function prepareMessageWithRelationships(
  message: Message,
  messages: Message[],
  selectedModelId: string
): Message {
  // Create a copy of the message to avoid mutation
  const messageCopy = { ...message };
  let parentMessageId = null;

  // For assistant messages, parent should be the last user message
  if (message.role === "assistant") {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        parentMessageId = messages[i].id;
        break;
      }
    }
  }
  // For user messages, parent should be the last assistant message if any
  else if (message.role === "user" && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        parentMessageId = messages[i].id;
        break;
      }
    }
  }

  return {
    ...messageCopy,
    parent_id: parentMessageId,
    children_ids: (messageCopy as ExtendedMessage).children_ids || [],
    // For assistant messages, always set the model
    model:
      message.role === "assistant"
        ? selectedModelId || "unknown"
        : (messageCopy as ExtendedMessage).model,
    // Ensure parts is defined for compatibility
    parts: Array.isArray((messageCopy as any).parts)
      ? (messageCopy as any).parts
      : [],
  } as Message;
}

/**
 * Saves chat messages to the database
 * @param chatId The chat ID
 * @param messages Array of messages to save
 * @returns Promise that resolves when save is complete
 */
export async function saveChatMessages(
  chatId: string,
  messages: Message[]
): Promise<Response> {
  // Final check to ensure all assistant messages have a model
  const sanitizedMessages = messages.map((message) => {
    if (message.role === "assistant") {
      const extMessage = message as ExtendedMessage;
      // If model is null or undefined, set it to "unknown"
      if (!extMessage.model) {
        return {
          ...message,
          model: "unknown",
        };
      }
    }
    return message;
  });

  return fetch(`/api/chat/messages?id=${chatId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: sanitizedMessages }),
  });
}

/**
 * Safely converts a standard Message to an ExtendedMessage
 * ensuring all required properties are present
 * @param message The message to convert
 * @returns Message with all ExtendedMessage properties
 */
export function ensureExtendedMessage(message: Message): ExtendedMessage {
  const extendedMessage = message as ExtendedMessage;
  return {
    ...message,
    parent_id: extendedMessage.parent_id || null,
    children_ids: extendedMessage.children_ids || [],
    // For assistant messages, ensure model is never null
    model:
      message.role === "assistant"
        ? extendedMessage.model || "unknown"
        : extendedMessage.model,
    parts: Array.isArray(extendedMessage.parts) ? extendedMessage.parts : [],
  };
}

// Helper function to process messages and handle branch logic
export function processMessages(
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
export function removeDuplicateUserMessages(
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
export async function createCompatibleDataStream(
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
