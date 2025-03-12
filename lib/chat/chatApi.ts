/**
 * Chat API Service
 *
 * This module provides functions for making API calls to the chat completion API
 * and handling streaming responses. It abstracts away the details of the API
 * interaction to provide a cleaner interface for the rest of the application.
 */

import { Message, Attachment } from "ai";
import type { JSONValue, ToolCall } from "ai";
import { callChatApi, UIMessage } from "@ai-sdk/ui-utils";
import {
  ExtendedMessage as ChatExtendedMessage,
  StreamProtocol,
} from "@/lib/utils/chat";
import logger from "@/lib/utils/logger";
import {
  AppError,
  handleError,
  createChatError,
} from "@/lib/utils/error-handling";
import { ExtendedMessage } from "../utils";
import { ensureParentRelationship } from "../messages/relationships";

/**
 * Interface for streaming chat messages to an API
 */
export interface StreamChatMessagesOptions {
  /** Messages to send to the API */
  messages: Message[];
  /** ID of the chat */
  id: string;
  /** Model to use for completion */
  model: string;
  /** API endpoint */
  api: string;
  /** Stream protocol to use */
  streamProtocol: StreamProtocol;
  /** HTTP headers */
  headers?: Record<string, string>;
  /** Additional body parameters */
  body?: Record<string, any>;
  /** File attachments */
  attachments?: Attachment[];
  /** Function to get the abort controller */
  getAbortController: () => AbortController | null;
  /** Callback when a response is received */
  onResponse?: (response: Response) => void | Promise<void>;
  /** Callback for message updates during streaming */
  onUpdate: ({
    message,
    replaceLastMessage,
  }: {
    message: ChatExtendedMessage;
    replaceLastMessage: boolean;
  }) => void;
  /** Callback for stream parts */
  onStreamPart?: (part: string, delta: any, type: string) => void;
  /** Callback when the stream is finished */
  onFinish: (
    message: ChatExtendedMessage,
    finishReason?: Record<string, any>
  ) => void;
  /** Callback for tool calls */
  onToolCall?: (toolCall: {
    toolCallId: string;
    toolName: string;
    args: any;
  }) => Promise<any>;
  /** Callback for errors */
  onError?: (error: Error) => void;
  /** Function to restore messages on failure */
  restoreMessagesOnFailure?: () => void;
  /** Whether to replace the last message during streaming */
  replaceLastMessage?: boolean;
  /** The last message for context */
  lastMessage?: ChatExtendedMessage;
}

/**
 * Adapter function that connects our application's chat logic to the underlying callChatApi
 * @param params - Parameters for the API call
 * @returns Promise that resolves when the API call is complete
 */
async function adaptCallChatApi({
  messages,
  id,
  model,
  api,
  streamProtocol,
  headers,
  body,
  attachments,
  abortController,
  onResponse,
  onUpdate: handleUpdate,
  onStreamPart,
  onFinish,
  onToolCall,
  onError,
  restoreMessagesOnFailure,
  replaceLastMessage,
  lastMessage,
}: {
  messages: Message[];
  id: string;
  model: string;
  api: string;
  streamProtocol: StreamProtocol;
  headers?: Record<string, string>;
  body?: Record<string, any>;
  attachments?: Attachment[];
  abortController: (() => AbortController | null) | undefined;
  onResponse?: (response: Response) => void | Promise<void>;
  onUpdate: ({
    message,
    replaceLastMessage,
  }: {
    message: ChatExtendedMessage;
    replaceLastMessage: boolean;
  }) => void;
  onStreamPart?: (part: string, delta: any, type: string) => void;
  onFinish: (
    message: ChatExtendedMessage,
    finishReason?: Record<string, any>
  ) => void;
  onToolCall?: (toolCall: {
    toolCallId: string;
    toolName: string;
    args: any;
  }) => Promise<any>;
  onError?: (error: Error) => void;
  restoreMessagesOnFailure?: () => void;
  replaceLastMessage: boolean;
  lastMessage: ChatExtendedMessage;
}) {
  // Adapt the lastMessage to UIMessage format
  const adaptedLastMessage: UIMessage = {
    id: lastMessage.id,
    role: lastMessage.role,
    content: lastMessage.content,
    createdAt: lastMessage.createdAt,
    // Ensure parts is not undefined
    parts: lastMessage.parts || [],
  };

  // Adapt onUpdate to match expected signature
  const adaptedOnUpdate = (options: {
    message: UIMessage;
    data: JSONValue[] | undefined;
    replaceLastMessage: boolean;
  }) => {
    // Find parent_id for assistant messages if not already set
    let parentId = (options.message as any).parent_id;

    parentId = ensureParentRelationship(
      messages,
      options.message as ExtendedMessage
    );

    // Convert UIMessage back to ChatExtendedMessage with proper relationship data
    const chatExtMsg: ExtendedMessage = {
      ...options.message,
      parent_id: parentId,
      children_ids: (options.message as any).children_ids || [],
      model: (options.message as any).model || model || "unknown",
      parts: options.message.parts,
      reasoning: options.message.reasoning,
    };

    // Update the UI with the processed message
    handleUpdate({
      message: chatExtMsg,
      replaceLastMessage: options.replaceLastMessage,
    });
  };

  // Adapt onToolCall to match expected signature
  const adaptedOnToolCall = onToolCall
    ? ({ toolCall }: { toolCall: ToolCall<string, unknown> }) => {
        return onToolCall({
          toolCallId: toolCall.toolCallId || "",
          toolName: toolCall.toolName,
          args: toolCall.args,
        });
      }
    : undefined;

  // Ensure restoreMessagesOnFailure is never undefined
  const adaptedRestoreMessagesOnFailure =
    restoreMessagesOnFailure || (() => {});

  // Call the original function with adapted parameters
  await callChatApi({
    api,
    body: {
      id,
      ...body,
      messages,
      ...(attachments ? { experimental_attachments: attachments } : {}),
    },
    streamProtocol,
    credentials: undefined,
    headers,
    abortController,
    restoreMessagesOnFailure: adaptedRestoreMessagesOnFailure,
    onResponse,
    onUpdate: adaptedOnUpdate,
    onFinish: (message, details) => {
      const parentId = ensureParentRelationship(
        messages,
        message as ExtendedMessage
      );

      // Convert UIMessage to ChatExtendedMessage with all necessary fields
      const adaptedMessage: ExtendedMessage = {
        ...message,
        parent_id: parentId || body?.parentMessageId || null,
        children_ids: [],
        model: (message as any).model || model || "unknown",
        parts: message.parts || [],
        reasoning: message.reasoning,
      };

      onFinish(adaptedMessage, details);
    },
    onToolCall: adaptedOnToolCall,
    // IdGenerator is needed, but we'll use a simple implementation
    generateId: () => crypto.randomUUID(),
    fetch: fetch,
    lastMessage: adaptedLastMessage,
  });

  // No need to return anything, we're not using the result
  return null;
}

/**
 * Main function for streaming chat messages to the API
 * This is a high-level wrapper around adaptCallChatApi that provides a clean interface
 *
 * @param options - Options for the API call
 * @returns Promise<string|null> - ID of the last message or null if error
 */
export async function streamChatMessages({
  messages,
  id,
  model,
  api,
  streamProtocol,
  headers,
  body,
  attachments,
  getAbortController,
  onResponse,
  onUpdate,
  onStreamPart,
  onFinish,
  onToolCall,
  onError,
  restoreMessagesOnFailure,
  replaceLastMessage = true,
  lastMessage,
}: StreamChatMessagesOptions): Promise<string | null> {
  try {
    // Log the streaming request
    logger.debug("Streaming chat messages", {
      context: {
        messageCount: messages.length,
        chatId: id,
        model,
        api,
      },
      module: "chatApi",
    });

    if (!lastMessage && messages.length > 0) {
      // Use the last message in the array if not explicitly provided
      lastMessage = messages[messages.length - 1] as ChatExtendedMessage;
    }

    if (!lastMessage) {
      throw createChatError(
        "No last message available for streaming context",
        "STREAMING_FAILED",
        { chatId: id, model }
      );
    }

    // Call the adapter function
    await adaptCallChatApi({
      messages,
      id,
      model,
      api,
      streamProtocol,
      headers,
      body,
      attachments,
      abortController: () => getAbortController(),
      onResponse,
      onUpdate,
      onStreamPart,
      onFinish,
      onToolCall,
      onError,
      restoreMessagesOnFailure,
      replaceLastMessage,
      lastMessage,
    });

    // Return the ID of the last message
    return lastMessage.id;
  } catch (error) {
    // Handle errors using our new utility
    const handledError =
      error instanceof AppError
        ? error
        : error instanceof Error && error.name === "AbortError"
        ? createChatError("Chat stream aborted by user", "STREAMING_FAILED", {
            chatId: id,
            model,
          })
        : handleError(error, "chatApi", {
            chatId: id,
            model,
            messageCount: messages.length,
          });

    // Call error handler if provided
    if (onError) {
      try {
        onError(handledError);
      } catch (callbackError) {
        // If the error handler throws, handle that error too
        handleError(callbackError, "chatApi", {
          context: "Error in onError callback",
          originalError: handledError.message,
        });
      }
    }

    return null;
  }
}
