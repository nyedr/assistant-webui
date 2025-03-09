import { Message } from "ai";
import logger from "./logger";
import { RouteValidatedMessage } from "@/app/(chat)/api/chat/proxy/route";

// Define protocol types supported by Vercel AI SDK
export type StreamProtocol = "text" | "data";

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
  toolInvocations?: ToolInvocation[];
}

// Function to ensure seamless continuation without extra spaces
export const combineContent = (
  original: string,
  continuation: string
): string => {
  // Remove trailing newlines from original content
  const trimmedOriginal = original.replace(/\n+$/, " ");

  // Trim any leading whitespace from continuation
  const trimmedContinuation = continuation.trimStart();

  // Check if we need to add a space between the two parts
  // If original ends with a character that needs a space after it, add one
  const needsSpace =
    trimmedOriginal.length > 0 &&
    trimmedContinuation.length > 0 &&
    !trimmedOriginal.endsWith("\n") &&
    !trimmedOriginal.endsWith(" ") &&
    !trimmedOriginal.endsWith(".") &&
    !trimmedOriginal.endsWith("!") &&
    !trimmedOriginal.endsWith("?") &&
    !trimmedOriginal.endsWith(":");

  return needsSpace
    ? `${trimmedOriginal} ${trimmedContinuation}`
    : `${trimmedOriginal}${trimmedContinuation}`;
};

// Helper function to handle message continuation
export const handleContinuation = (
  messages: RouteValidatedMessage[],
  continueMessageId?: string,
  originalContent?: string
): RouteValidatedMessage[] => {
  // If not a continuation request, return messages as is
  if (!continueMessageId || !originalContent) {
    return messages;
  }

  logger.debug(`Handling continuation for message: ${continueMessageId}`, {
    module: "proxy",
    context: {
      messageCount: messages.length,
      originalContentLength: originalContent.length,
      originalContentEnding: originalContent.slice(-20), // Log the last 20 chars
    },
  });

  // Find the system message that contains the continuation instructions
  const systemMessageIndex = messages.findIndex(
    (msg) =>
      msg.role === "system" &&
      msg.content.includes("Continue the assistant's previous response")
  );

  if (systemMessageIndex === -1) {
    logger.warn("No continuation system message found", { module: "proxy" });
    return messages;
  }

  // Create a new message that combines the original content with the system message
  const systemMessage = messages[systemMessageIndex];
  const enhancedSystemMessage: RouteValidatedMessage = {
    ...systemMessage,
    content: `${
      systemMessage.content
    }\n\nHere is the exact content to continue from (do not repeat any part of this):\n"${originalContent.trim()}"\n\nContinue directly from this point, ensuring your response flows naturally. Do not start with transitional phrases or repeat any content.`,
  };

  // Replace the system message with the enhanced one
  const updatedMessages = [...messages];
  updatedMessages[systemMessageIndex] = enhancedSystemMessage;

  logger.debug("Enhanced system message for continuation", {
    module: "proxy",
    context: {
      originalLength: systemMessage.content.length,
      enhancedLength: enhancedSystemMessage.content.length,
    },
  });

  return updatedMessages;
};
