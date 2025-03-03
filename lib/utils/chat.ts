import { Message, Attachment } from "ai";
import { generateUUID } from "@/lib/utils";

// Define protocol types supported by Vercel AI SDK
export type StreamProtocol = "text" | "data";

// Define more structured part types for UI messages
export type TextPart = {
  type: "text";
  text: string;
  isContinued?: boolean;
};

export type ReasoningPart = {
  type: "reasoning";
  reasoning: string;
  isContinued?: boolean;
  details: Array<
    | { type: "text"; text: string; signature?: string }
    | { type: "redacted"; data: string }
  >;
};

export type ToolInvocationPart = {
  type: "tool-invocation";
  toolInvocation: ToolInvocation;
};

export type SourcePart = {
  type: "source";
  source: any; // Would be more specific in a real implementation
};

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolInvocationPart
  | SourcePart;

// Define tool invocation types
export type ToolInvocation =
  | ({ state: "partial-call"; step?: number } & ToolCall)
  | ({ state: "call"; step?: number } & ToolCall)
  | ({ state: "result"; step?: number } & ToolResult);

export type ToolCall = {
  toolCallId: string;
  toolName: string;
  args: any;
};

export type ToolResult = ToolCall & {
  result: any;
};

// Define the main types for the stream utilities
export interface StreamOptions {
  id?: string;
  model?: string;
  api?: string;
  headers?: Record<string, string>;
  body?: Record<string, any>;
  streamProtocol?: StreamProtocol;
  experimental_attachments?: Attachment[];
  experimental_streamData?: boolean;
  experimental_stopOnAbort?: boolean;
  onResponse?: (response: Response) => void | Promise<void>;
  onFinish?: (
    message: ExtendedMessage,
    finishReason?: Record<string, any>
  ) => void;
  onError?: (error: Error) => void;
  onStreamPart?: (part: string, delta: any, type: string) => void;
  onToolCall?: (toolCall: {
    toolCallId: string;
    toolName: string;
    args: any;
  }) => Promise<any>;
  abortController?: AbortController;
}

// Extended Message that includes optional extended properties
export interface ExtendedMessage extends Message {
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
  reasoning?: string;
  reasoning_signature?: string;
  redacted_reasoning?: string;
  source?: any;
  data?: Record<string, any>;
  annotations?: any[];
  toolInvocations?: ToolInvocation[];
  parts?: MessagePart[];
}

export interface StreamResult {
  /**
   * The abort controller that can be used to cancel the stream.
   */
  abortController: AbortController;

  /**
   * A promise that resolves when the stream is complete.
   */
  promise: Promise<ExtendedMessage | null>;
}

// Helper function to attempt parsing partial JSON
function parsePartialJson(text: string): { value: any; error?: Error } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    // Try to salvage malformed JSON by adding missing brackets/braces
    try {
      // If it starts with a { but doesn't end with one, add it
      if (text.trim().startsWith("{") && !text.trim().endsWith("}")) {
        return { value: JSON.parse(text + "}") };
      }
      // If it starts with a [ but doesn't end with one, add it
      if (text.trim().startsWith("[") && !text.trim().endsWith("]")) {
        return { value: JSON.parse(text + "]") };
      }

      // If all else fails, return the original error
      return {
        value: {},
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } catch (innerError) {
      return {
        value: {},
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

/**
 * Extract text content from a potentially formatted string
 * Handles both the 0: prefix format and quoted JSON strings
 */
function extractTextContent(value: string): string {
  // Check for the custom format pattern
  const formatMatch = /^0:"(.*)"$/.exec(value);
  if (formatMatch) {
    // Extract the text content from the quotes
    let content = formatMatch[1];

    // Handle escaped characters (including newlines)
    content = content
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\\\/g, "\\");

    return content;
  }

  try {
    // Try to parse as JSON
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch (e) {
    // Not JSON, continue with other methods
  }

  // If it starts with 0: but doesn't match the pattern, extract after prefix
  if (value.startsWith("0:")) {
    const content = value.slice(2);
    // Handle escaped characters here too
    return content
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\\\/g, "\\");
  }

  return value;
}

/**
 * Converts a ReadableStream to text chunks and processes them for display
 */
async function processTextStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: StreamOptions,
  abortSignal?: AbortSignal,
  onUpdateCallback?: (message: ExtendedMessage, finishReason?: string) => void
): Promise<ExtendedMessage> {
  const decoder = new TextDecoder();
  const messageId = generateUUID();
  let accumulatedMessage = "";
  let finishReason = "streaming";
  let lastUpdateTime = Date.now();
  const updateThrottleMs = 50; // Only update UI every 50ms max

  // Create message parts for structured display
  const messageParts: MessagePart[] = [];
  let currentTextPart: TextPart | undefined;

  // Function to create a current snapshot of the message for UI updates
  const createMessageSnapshot = (): ExtendedMessage => {
    const snapshot: ExtendedMessage = {
      id: messageId,
      role: "assistant",
      content: accumulatedMessage,
      createdAt: new Date(),
      parts: [...messageParts], // Clone the parts array
    };
    return snapshot;
  };

  // Function to update the UI with current message state
  const updateUI = (forceUpdate = false) => {
    if (!onUpdateCallback) return;

    const now = Date.now();

    // Only update if enough time has passed or we're forcing an update
    if (forceUpdate || now - lastUpdateTime > updateThrottleMs) {
      lastUpdateTime = now;
      const snapshot = createMessageSnapshot();
      onUpdateCallback(snapshot, finishReason);
    }
  };

  // Force an initial update to ensure onUpdate is called at least once
  if (onUpdateCallback) {
    const initialSnapshot = createMessageSnapshot();
    onUpdateCallback(initialSnapshot, finishReason);
  }

  let done = false;
  while (!done && (!abortSignal || !abortSignal.aborted)) {
    const result = await reader.read();
    done = !!result.done;

    if (result.done) {
      break;
    }

    // Convert the chunk to string
    const chunk = decoder.decode(result.value, { stream: true });
    accumulatedMessage += chunk;

    // Call stream part handler if provided
    if (options.onStreamPart) {
      options.onStreamPart(chunk, chunk, "text");
    }

    // Update text part
    if (!currentTextPart) {
      currentTextPart = {
        type: "text",
        text: chunk,
      };
      messageParts.push(currentTextPart);
    } else {
      currentTextPart.text += chunk;
    }

    // Send incremental updates to the UI
    updateUI();
  }

  // Set final finish reason
  finishReason = "stop";

  // Ensure we have at least an empty text part for empty streams
  if (messageParts.length === 0) {
    currentTextPart = {
      type: "text",
      text: "",
    };
    messageParts.push(currentTextPart);
  }

  // Final update with complete message
  updateUI(true);

  // Call onFinish callback if provided
  if (options.onFinish) {
    const message = createMessageSnapshot();
    options.onFinish(message, { finishReason });
  }

  return createMessageSnapshot();
}

// Add a helper function to safely access nested properties
function safeGet(obj: any, path: string[], defaultValue: any = undefined): any {
  let current = obj;
  for (const key of path) {
    if (current === undefined || current === null) return defaultValue;
    current = current[key];
  }
  return current !== undefined ? current : defaultValue;
}

/**
 * Parse and process the data stream protocol
 * https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol#data-stream-protocol
 */
async function processDataStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: StreamOptions,
  abortSignal?: AbortSignal,
  onUpdateCallback?: (message: ExtendedMessage, finishReason?: string) => void
): Promise<ExtendedMessage> {
  const decoder = new TextDecoder();

  let messageId = options.id || generateUUID();
  let accumulatedMessage = "";
  let reasoning = "";
  let reasoningSignature = "";
  let redactedReasoning = "";
  let source: Record<string, any> | null = null;
  let messageData: Record<string, any> = {};
  const annotations: any[] = [];
  const toolCalls: Record<string, any> = {};
  const toolResults: Record<string, any> = {};
  const toolInvocations: ToolInvocation[] = [];
  let error = "";
  let finishReason = "streaming"; // Start with streaming as the status
  let lastUpdateTime = Date.now();
  const updateThrottleMs = 50; // Only update UI every 50ms max

  // Track the parts of the message for structured display
  const messageParts: MessagePart[] = [];
  let currentTextPart: TextPart | undefined;
  let currentReasoningPart: ReasoningPart | undefined;
  let currentReasoningTextDetail:
    | { type: "text"; text: string; signature?: string }
    | undefined;

  // Keep track of partial tool calls
  const partialToolCalls: Record<
    string,
    { text: string; step: number; toolName: string }
  > = {};
  let step = 0;

  // Function to create a current snapshot of the message for UI updates
  const createMessageSnapshot = (): ExtendedMessage => {
    // Use the accumulated message for content
    const snapshot: ExtendedMessage = {
      id: messageId,
      role: "assistant",
      content: accumulatedMessage, // Use the accumulated message
      createdAt: new Date(),
      parts: [...messageParts], // Clone the parts array
      data: {
        reasoning,
        reasoning_signature: reasoningSignature,
        source,
        annotations: annotations.length > 0 ? [...annotations] : undefined,
        toolCalls:
          Object.keys(toolCalls).length > 0 ? { ...toolCalls } : undefined,
        toolResults:
          Object.keys(toolResults).length > 0 ? { ...toolResults } : undefined,
        error,
        ...messageData,
      },
    };

    // Add top-level properties for backward compatibility
    if (reasoning) {
      snapshot.reasoning = reasoning;
    }

    if (reasoningSignature) {
      snapshot.reasoning_signature = reasoningSignature;
    }

    if (source) {
      snapshot.source = source;
    }

    if (annotations.length > 0) {
      snapshot.annotations = [...annotations];
    }

    if (toolInvocations.length > 0) {
      snapshot.toolInvocations = [...toolInvocations];
    }

    return snapshot;
  };

  // Function to update the UI with current message state
  const updateUI = (forceUpdate = false) => {
    if (!onUpdateCallback) return;

    const now = Date.now();

    // Only update if enough time has passed or we're forcing an update
    if (forceUpdate || now - lastUpdateTime > updateThrottleMs) {
      lastUpdateTime = now;
      const snapshot = createMessageSnapshot();
      onUpdateCallback(snapshot, finishReason);
    }
  };

  const processStreamPart = async (line: string) => {
    // Skip empty lines
    if (!line) return;

    // Remove the "data: " prefix if it exists
    const jsonLine = line.startsWith("data: ") ? line.slice(6) : line;

    try {
      // Parse the JSON data
      const data = JSON.parse(jsonLine);
      console.log("Parsed JSON data:", data);

      // Skip if no type
      if (!data.type) return;

      let shouldUpdateUI = false;

      // Case handlers for different event types
      switch (data.type) {
        case "start_message":
          // Initialize the message with the ID from the response if available
          if (data.messageId) {
            messageId = data.messageId;
          }
          shouldUpdateUI = true;
          break;

        case "start_step":
          // If we have a messageId in the response, use it
          if (data.messageId) {
            // Store it just so we have it for reference
            messageData.responseMessageId = data.messageId;
          }
          shouldUpdateUI = true;
          break;

        case "text":
          // Process text value - handle both direct values and formatted strings
          if (data.value) {
            let textValue = data.value;

            // Check if we need to extract content from a formatted string
            if (typeof textValue === "string") {
              const extractedText = extractTextContent(textValue);
              console.log(
                `Processed text value: ${textValue} → ${extractedText}`
              );
              textValue = extractedText;
            }

            // Update the accumulated content and current text part
            accumulatedMessage += textValue;

            // Create or update the text part
            if (!currentTextPart) {
              currentTextPart = {
                type: "text",
                text: textValue,
              };
            } else {
              currentTextPart.text += textValue;
            }

            shouldUpdateUI = true;
          }
          break;

        case "reasoning": {
          if (!currentReasoningTextDetail) {
            currentReasoningTextDetail = { type: "text", text: data.value };
            if (currentReasoningPart) {
              currentReasoningPart.details.push(currentReasoningTextDetail);
            }
          } else {
            currentReasoningTextDetail.text += data.value;
          }

          if (!currentReasoningPart) {
            currentReasoningPart = {
              type: "reasoning",
              reasoning: data.value,
              details: [currentReasoningTextDetail],
            };
            messageParts.push(currentReasoningPart);
          } else {
            currentReasoningPart.reasoning += data.value;
          }

          reasoning += data.value;
          shouldUpdateUI = true;
          break;
        }

        case "redacted_reasoning": {
          if (!currentReasoningPart) {
            currentReasoningPart = {
              type: "reasoning",
              reasoning: "",
              details: [],
            };
            messageParts.push(currentReasoningPart);
          }

          currentReasoningPart.details.push({
            type: "redacted",
            data: data.data,
          });

          currentReasoningTextDetail = undefined;
          redactedReasoning += data.data;
          shouldUpdateUI = true;
          break;
        }

        case "reasoning_signature":
          reasoningSignature = data.value.signature;
          if (currentReasoningTextDetail) {
            currentReasoningTextDetail.signature = data.value.signature;
          }
          shouldUpdateUI = true;
          break;

        case "source":
          source = data.value;
          messageParts.push({
            type: "source",
            source: data.value,
          });
          shouldUpdateUI = true;
          break;

        case "message_annotation":
          // Push the annotation value directly, not as an array
          if (Array.isArray(data.value)) {
            annotations.push(...data.value);
          } else {
            annotations.push(data.value);
          }
          shouldUpdateUI = true;
          break;

        case "data":
          // Merge data parts
          messageData = { ...messageData, ...data.value };
          shouldUpdateUI = true;
          break;

        case "error": {
          error = data.value;
          finishReason = "error";

          // Enhanced error handling - call onError for explicit error messages from server
          if (options.onError && data.value) {
            const errorObj = new Error(data.value);
            errorObj.name = "StreamError";
            options.onError(errorObj);
          }

          // Force an update with the error state
          shouldUpdateUI = true;
          break;
        }

        case "tool_call_streaming_start": {
          toolCalls[data.value.toolCallId] = {
            id: data.value.toolCallId,
            name: data.value.toolName,
            args: "",
          };

          // Add to partial tool calls for streaming
          partialToolCalls[data.value.toolCallId] = {
            text: "",
            step,
            toolName: data.value.toolName,
          };

          // Create a tool invocation with partial state
          const partialInvocation: ToolInvocation = {
            state: "partial-call",
            step,
            toolCallId: data.value.toolCallId,
            toolName: data.value.toolName,
            args: {},
          };

          // Add to tool invocations array
          if (
            !toolInvocations.some((t) => t.toolCallId === data.value.toolCallId)
          ) {
            toolInvocations.push(partialInvocation);
          }

          // Add to message parts
          messageParts.push({
            type: "tool-invocation",
            toolInvocation: partialInvocation,
          });

          shouldUpdateUI = true;
          break;
        }

        case "tool_call_delta": {
          if (partialToolCalls[data.value.toolCallId]) {
            const partialCall = partialToolCalls[data.value.toolCallId];
            partialCall.text += data.value.argsTextDelta;

            // Try to parse the partial JSON
            const { value: partialArgs } = parsePartialJson(partialCall.text);

            // Update the tool call with the partial args
            if (toolCalls[data.value.toolCallId]) {
              toolCalls[data.value.toolCallId].args = partialCall.text;
            }

            // Update the tool invocation with partial args
            const invocationIndex = toolInvocations.findIndex(
              (t) => t.toolCallId === data.value.toolCallId
            );

            if (invocationIndex !== -1) {
              toolInvocations[invocationIndex] = {
                ...toolInvocations[invocationIndex],
                args: partialArgs,
              };

              // Update the corresponding message part
              const partIndex = messageParts.findIndex(
                (p) =>
                  p.type === "tool-invocation" &&
                  p.toolInvocation.toolCallId === data.value.toolCallId
              );

              if (partIndex !== -1) {
                (messageParts[partIndex] as ToolInvocationPart).toolInvocation =
                  toolInvocations[invocationIndex];
              }
            }

            shouldUpdateUI = true;
          }
          break;
        }

        case "tool_call": {
          toolCalls[data.value.toolCallId] = {
            id: data.value.toolCallId,
            name: data.value.toolName,
            args: data.value.args,
          };

          // Create a full tool invocation
          const fullInvocation: ToolInvocation = {
            state: "call",
            step,
            toolCallId: data.value.toolCallId,
            toolName: data.value.toolName,
            args: data.value.args,
          };

          // Replace or add to tool invocations array
          const invocationIndex = toolInvocations.findIndex(
            (t) => t.toolCallId === data.value.toolCallId
          );

          if (invocationIndex !== -1) {
            toolInvocations[invocationIndex] = fullInvocation;
          } else {
            toolInvocations.push(fullInvocation);
          }

          // Update or add message part
          const partIndex = messageParts.findIndex(
            (p) =>
              p.type === "tool-invocation" &&
              p.toolInvocation.toolCallId === data.value.toolCallId
          );

          if (partIndex !== -1) {
            (messageParts[partIndex] as ToolInvocationPart).toolInvocation =
              fullInvocation;
          } else {
            messageParts.push({
              type: "tool-invocation",
              toolInvocation: fullInvocation,
            });
          }

          // Handle tool call if onToolCall is provided
          if (options.onToolCall) {
            options
              .onToolCall({
                toolCallId: data.value.toolCallId,
                toolName: data.value.toolName,
                args: data.value.args,
              })
              .then((result) => {
                // Store the result
                toolResults[data.value.toolCallId] = result;

                // Update the tool invocation with the result
                const resultInvocation: ToolInvocation = {
                  ...fullInvocation,
                  state: "result",
                  result,
                };

                // Update arrays
                const updatedIndex = toolInvocations.findIndex(
                  (t) => t.toolCallId === data.value.toolCallId
                );

                if (updatedIndex !== -1) {
                  toolInvocations[updatedIndex] = resultInvocation;
                }

                // Update message part
                const resultPartIndex = messageParts.findIndex(
                  (p) =>
                    p.type === "tool-invocation" &&
                    p.toolInvocation.toolCallId === data.value.toolCallId
                );

                if (resultPartIndex !== -1) {
                  (
                    messageParts[resultPartIndex] as ToolInvocationPart
                  ).toolInvocation = resultInvocation;
                }

                // Force an update for the tool result
                updateUI(true);
              })
              .catch((error) => {
                console.error("Error handling tool call:", error);
                if (options.onError) {
                  options.onError(
                    error instanceof Error ? error : new Error(String(error))
                  );
                }
              });
          }

          shouldUpdateUI = true;
          break;
        }

        case "tool_result": {
          toolResults[data.value.toolCallId] = data.value.result;

          // Find the corresponding tool invocation and update it
          const toolIndex = toolInvocations.findIndex(
            (t) => t.toolCallId === data.value.toolCallId
          );

          if (toolIndex !== -1) {
            const resultInvocation: ToolInvocation = {
              ...toolInvocations[toolIndex],
              state: "result",
              result: data.value.result,
            };

            toolInvocations[toolIndex] = resultInvocation;

            // Update message part
            const resultPartIndex = messageParts.findIndex(
              (p) =>
                p.type === "tool-invocation" &&
                p.toolInvocation.toolCallId === data.value.toolCallId
            );

            if (resultPartIndex !== -1) {
              (
                messageParts[resultPartIndex] as ToolInvocationPart
              ).toolInvocation = resultInvocation;
            }
          }

          shouldUpdateUI = true;
          break;
        }

        case "finish_step": {
          // Always ensure we have a valid finishReason
          finishReason = safeGet(
            [data, "finishReason"],
            ["finishReason"],
            "stop"
          );

          // Increment step counter
          step += 1;

          // Only reset current parts if we're not continuing to the next step
          if (data.value && !data.value.isContinued) {
            currentTextPart = undefined;
            currentReasoningPart = undefined;
            currentReasoningTextDetail = undefined;
          } else if (data.value && data.value.isContinued) {
            // For continued steps, we keep the current parts but mark them as continuing
            // This ensures UI continuity between steps
            if (currentTextPart) {
              // We're maintaining the same text part across steps
              currentTextPart.isContinued = true;
            }
            if (currentReasoningPart) {
              // We're maintaining the same reasoning part across steps
              currentReasoningPart.isContinued = true;
            }
          }

          shouldUpdateUI = true;
          break;
        }

        case "finish_message": {
          // Safely extract finishReason with a fallback
          console.log("Processing finish_message with data:", data);

          // Double-check that we have the right property path
          finishReason = safeGet([data], ["finishReason"], "stop");
          if (!finishReason && data.value && typeof data.value === "object") {
            finishReason = safeGet([data.value], ["finishReason"], "stop");
          }

          console.log("Final finishReason set to:", finishReason);

          // Final update with the complete message
          updateUI(true);

          // If we have an onFinish handler, call it with safe values
          if (options.onFinish) {
            // Create a finishReason object with a default
            const finishReasonObj = { finishReason: finishReason };

            // Add usage if available (safely)
            const usage = safeGet(
              [data],
              ["usage"],
              safeGet([data, "value"], ["usage"], undefined)
            );
            if (usage) {
              Object.assign(finishReasonObj, { usage });
            }

            try {
              options.onFinish(createMessageSnapshot(), finishReasonObj);
            } catch (err) {
              console.error("Error in onFinish callback:", err);
            }
          }

          break;
        }
      }

      // Update the UI if needed and enough time has passed
      if (shouldUpdateUI) {
        updateUI();
      }
    } catch (error) {
      console.error("Error processing stream part:", error, "Line:", line);
    }
  };

  try {
    let buffer = "";
    let done = false;

    // Force an initial update to ensure onUpdate is called at least once
    if (onUpdateCallback) {
      const initialSnapshot = createMessageSnapshot();
      onUpdateCallback(initialSnapshot, finishReason);
    }

    while (!done && (!abortSignal || !abortSignal.aborted)) {
      const result = await reader.read();
      done = !!result.done;

      if (result.done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          await processStreamPart(buffer.trim());
        }
        break;
      }

      const chunk = decoder.decode(result.value, { stream: true });
      buffer += chunk;

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep the last incomplete line in the buffer

      for (const line of lines) {
        if (line.trim()) {
          await processStreamPart(line.trim());
        }
      }
    }

    // Set final finish reason if we didn't get one from the stream
    if (finishReason === "streaming") {
      finishReason = "stop"; // Default to "stop" if we didn't get a specific finish reason
    }

    // Process tool call results and build the invocations array
    for (const id in toolCalls) {
      if (toolCalls[id] && !toolInvocations.some((t) => t.toolCallId === id)) {
        // Create a properly typed tool invocation
        if (toolResults[id]) {
          // Result type
          const invocation: ToolInvocation = {
            state: "result",
            step: 0,
            toolCallId: id,
            toolName: toolCalls[id].name,
            args: toolCalls[id].args,
            result: toolResults[id],
          };
          toolInvocations.push(invocation);
        } else {
          // Call type without result
          const invocation: ToolInvocation = {
            state: "call",
            step: 0,
            toolCallId: id,
            toolName: toolCalls[id].name,
            args: toolCalls[id].args,
          };
          toolInvocations.push(invocation);
        }
      }
    }

    // Build the final message
    const message = createMessageSnapshot();

    // Ensure there's at least an empty text part
    if (!message.parts?.some((part) => part.type === "text")) {
      const emptyTextPart: TextPart = {
        type: "text",
        text: "",
      };
      messageParts.push(emptyTextPart);

      // Update the message with the new parts array
      message.parts = [...messageParts];
    }

    // Call onFinish callback if provided
    if (options.onFinish) {
      options.onFinish(message, { finishReason });
    }

    return message;
  } catch (e) {
    console.error("Error processing data stream:", e);

    // Set error state
    error = e instanceof Error ? e.message : String(e);
    finishReason = "error";

    if (options.onError) {
      options.onError(e instanceof Error ? e : new Error(String(e)));
    }

    // Force a final error update
    if (onUpdateCallback) {
      const errorMessage = createMessageSnapshot();
      onUpdateCallback(errorMessage, "error");
    }

    throw e;
  }
}

/**
 * Streams a chat message to the AI and handles the response stream
 *
 * @param messages - The messages in the chat so far
 * @param options - Options for the stream request
 * @returns A promise that resolves to the assistant's response message or null if an error occurred
 */
export async function streamChat(
  messages: Message[],
  options: StreamOptions
): Promise<ExtendedMessage | null> {
  // Use the provided AbortController from options instead of creating a new one
  const abortController = options.abortController || new AbortController();

  try {
    // Prepare the API endpoint
    const apiEndpoint = options.api || "/api/chat/proxy";

    // Prepare the request body
    const body = {
      messages: messages.map((msg) => {
        return {
          id: msg.id,
          role: msg.role,
          content: msg.content,
        };
      }),
      model: options.model,
      id: options.id,
      stream: true,
      streamProtocol: options.streamProtocol || "text",
      ...(options.body || {}),
      ...(options.experimental_attachments
        ? {
            attachments: options.experimental_attachments,
          }
        : {}),
    };

    // Make the fetch request
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    // Call the onResponse callback if provided
    if (options.onResponse) {
      await options.onResponse(response);
    }

    // Check for error responses
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP error ${response.status}${errorText ? `: ${errorText}` : ""}`
      );
    }

    // Check if we have a body to read from
    if (!response.body) {
      throw new Error("No response body");
    }

    // Get the reader from the response body
    const reader = response.body.getReader();

    // Process the stream based on the protocol
    if (options.streamProtocol === "text") {
      const result = await processTextStream(
        reader,
        {
          onStreamPart: options.onStreamPart,
          onFinish: options.onFinish,
          onError: options.onError,
        },
        abortController.signal
      );

      // Check if the controller was aborted during processing
      if (abortController.signal.aborted) {
        return null;
      }

      // Final update with complete message and finishReason "stop"
      if (options.onFinish) {
        options.onFinish(result, { finishReason: "stop" });
      }

      return result;
    } else {
      // Default to data protocol
      return await processDataStream(reader, options);
    }
  } catch (e) {
    // Handle errors
    const error = e instanceof Error ? e : new Error(String(e));

    // Only call onError if it's not an AbortError (which means the user intentionally aborted)
    if (options.onError && error.name !== "AbortError") {
      options.onError(error);
    }

    return null;
  }
}

/**
 * Starts streaming a chat and returns both the abort controller and the promise
 * This allows external code to cancel the stream without waiting for it to complete
 */
export function startChatStream(
  messages: Message[],
  options: StreamOptions
): StreamResult {
  const abortController = new AbortController();

  // Create options with the abort controller
  const streamOptions: StreamOptions = {
    ...options,
    experimental_stopOnAbort: true,
    abortController, // Pass the abortController to streamChat
  };

  // Start the stream
  const promise = streamChat(messages, streamOptions);

  return {
    abortController,
    promise,
  };
}

/**
 * Create a standalone hook-less implementation of chat streaming
 * for testing and component usage
 */
export function createChatStream(options: StreamOptions = {}) {
  // Track the current stream
  let currentStream: StreamResult | null = null;

  return {
    /**
     * Stream a chat message to the AI
     */
    streamChat: async (
      messages: Message[],
      customOptions: Partial<StreamOptions> = {}
    ): Promise<ExtendedMessage | null> => {
      // If we have an existing stream, don't start a new one
      if (currentStream) {
        console.warn("A stream is already in progress. Call stop() first.");
        return null;
      }

      // Merge options
      const streamOptions: StreamOptions = {
        ...options,
        ...customOptions,
      };

      // Start the stream
      currentStream = startChatStream(messages, streamOptions);

      try {
        // Wait for the stream to complete
        const result = await currentStream.promise;
        return result;
      } finally {
        // Clear the current stream
        currentStream = null;
      }
    },

    /**
     * Stop the current stream if one is in progress
     */
    stop: () => {
      if (currentStream) {
        currentStream.abortController.abort();
        currentStream = null;
      }
    },
  };
}

// Define the StreamChatMessageOptions interface
export interface StreamChatMessageOptions {
  messages: Message[];
  id: string;
  model?: string;
  api?: string;
  streamProtocol?: StreamProtocol;
  headers?: Record<string, string>;
  body?: Record<string, any>;
  attachments?: Attachment[];
  abortController: (() => AbortController) | AbortController;
  onResponse?: (response: Response) => void | Promise<void>;
  onUpdate?: (options: {
    message: ExtendedMessage;
    data: any[] | undefined;
    replaceLastMessage: boolean;
    finishReason?: string;
  }) => void;
  onStreamPart?: (part: string, delta: any, type: string) => void;
  onFinish?: (
    message: ExtendedMessage,
    finishReason?: Record<string, any>
  ) => void;
  onToolCall?: (toolCall: {
    toolCallId: string;
    toolName: string;
    args: any;
  }) => Promise<any>;
  onError?: (error: Error) => void;
  restoreMessagesOnFailure?: () => void;
  replaceLastMessage?: boolean;
  lastMessage?: ExtendedMessage;
}

export async function streamChatMessage({
  messages,
  id,
  model,
  api = "/api/chat/proxy",
  streamProtocol = "data",
  headers,
  body = {},
  attachments,
  abortController,
  onResponse,
  onUpdate,
  onStreamPart,
  onFinish,
  onToolCall,
  onError,
  restoreMessagesOnFailure,
  replaceLastMessage = false,
  lastMessage,
}: StreamChatMessageOptions): Promise<ExtendedMessage | null> {
  // If abortController is an instance, use it directly; otherwise, call the function to get a new instance
  const controller =
    typeof abortController === "function"
      ? abortController()
      : abortController &&
        typeof abortController === "object" &&
        "signal" in abortController
      ? (abortController as AbortController)
      : new AbortController();
  const accumulatedData: any[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let response: Response | null = null;

  try {
    // Prepare the request body
    const requestBody = {
      messages: messages.map((message: Message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        ...(message.experimental_attachments && {
          experimental_attachments: message.experimental_attachments,
        }),
      })),
      model,
      id, // Ensure the chat ID is included in the request body
      stream: true,
      streamProtocol,
      ...body,
      ...(attachments && attachments.length > 0 && { attachments }),
    };

    // Make the fetch request with error handling for initial fetch
    response = await fetch(api, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(headers || {}),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    }).catch((err) => {
      if (restoreMessagesOnFailure) {
        restoreMessagesOnFailure();
      }
      throw err;
    });

    // Check if the controller was aborted during the fetch
    if (controller.signal.aborted) {
      return null;
    }

    // Call the onResponse callback if provided
    if (onResponse) {
      await onResponse(response);
    }

    // Check for error responses
    if (!response.ok) {
      if (restoreMessagesOnFailure) {
        restoreMessagesOnFailure();
      }

      // Consume and close the response body to prevent memory leaks
      if (response.body) {
        const errorReader = response.body.getReader();
        try {
          // Read and discard the response body
          await errorReader.read();
        } catch (readError) {
          console.error("Error reading error response:", readError);
        } finally {
          // Always release the reader
          try {
            errorReader.releaseLock();
            await response.body.cancel();
          } catch (cancelError) {
            console.error(
              "Error canceling error response stream:",
              cancelError
            );
          }
        }
      }

      const errorText = await response
        .text()
        .catch((e) => `Failed to read error response: ${e.message}`);
      throw new Error(
        `HTTP error ${response.status}${errorText ? `: ${errorText}` : ""}`
      );
    }

    // Check if we have a body to read from
    if (!response.body) {
      throw new Error("No response body");
    }

    // Get the reader from the response body
    reader = response.body.getReader();

    // Create an update function that matches the SDK format
    const executeUpdate = (message: ExtendedMessage, finishReason?: string) => {
      // Ensure we have a valid finishReason or set a default
      const safeFinishReason = finishReason || "stop";

      if (onUpdate) {
        onUpdate({
          message,
          data: undefined,
          replaceLastMessage,
          finishReason: safeFinishReason,
        });
      }

      if (onFinish && finishReason) {
        onFinish(message, { finishReason: safeFinishReason });
      }
    };

    // Process based on the stream protocol
    if (streamProtocol === "text") {
      // Text protocol processing
      const result = await processTextStream(
        reader,
        {
          onStreamPart,
          onFinish,
          onError,
        },
        controller.signal,
        executeUpdate
      );

      // Check if the controller was aborted during processing
      if (controller.signal.aborted) {
        return null;
      }

      // Final update with complete message and finishReason "stop"
      executeUpdate(result, "stop");

      return result;
    } else if (streamProtocol === "data") {
      // For data protocol, set up capturing data parts
      const originalOnStreamPart = onStreamPart;

      // Wrap the onStreamPart to capture data
      const enhancedOptions: StreamOptions = {
        onStreamPart: (part, delta, type) => {
          // If it's a data part, add to accumulated data
          if (type === "data" && delta) {
            if (Array.isArray(delta)) {
              accumulatedData.push(...delta);
            } else {
              accumulatedData.push(delta);
            }
          }

          // Call original handler if provided
          if (originalOnStreamPart) {
            originalOnStreamPart(part, delta, type);
          }
        },
        onFinish,
        onToolCall,
        onError,
      };

      // Data protocol processing with real-time updates
      const result = await processDataStream(
        reader,
        enhancedOptions,
        controller.signal,
        executeUpdate
      );

      // Check if the controller was aborted during processing
      if (controller.signal.aborted) {
        return null;
      }

      // Ensure we execute a final update with the completed message
      executeUpdate(result, "stop");

      return result;
    } else {
      // This should never happen due to type checking
      throw new Error(`Unknown stream protocol: ${streamProtocol}`);
    }
  } catch (error) {
    // Handle errors
    const typedError =
      error instanceof Error ? error : new Error(String(error));

    // Only call onError if it's not an AbortError (which means the user intentionally aborted)
    if (onError && typedError.name !== "AbortError") {
      onError(typedError);
    }

    // If we have a restore function and this is an error that should trigger it
    if (restoreMessagesOnFailure && typedError.name !== "AbortError") {
      restoreMessagesOnFailure();
    }

    return null;
  } finally {
    // Ensure proper cleanup of resources
    if (reader) {
      try {
        // Release the reader lock
        reader.releaseLock();
      } catch (releaseError) {
        console.error("Error releasing reader lock:", releaseError);
      }
    }

    if (response && response.body) {
      try {
        // Cancel the stream to release resources
        await response.body.cancel();
      } catch (cancelError) {
        console.error("Error canceling response stream:", cancelError);
      }
    }

    // Clear references to help garbage collection
    reader = null;
    response = null;
  }
}
