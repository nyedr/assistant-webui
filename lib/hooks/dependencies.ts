/**
 * Dependencies for the useAIChat hook
 *
 * This module defines interfaces for the dependencies that can be injected
 * into the useAIChat hook to make it more testable.
 */

import type { ExtendedMessage } from "@/lib/utils/messages";
import type { Attachment } from "ai";
import type { StreamProtocol } from "@/lib/types/chat";

/**
 * Options for logger methods
 */
interface LogOptions {
  /**
   * Additional context data to include with the log
   */
  context?: Record<string, any>;

  /**
   * Module or component name for better filtering
   */
  module?: string;
}

/**
 * Interface for logger dependency
 */
export interface Logger {
  debug: (message: string, options?: LogOptions) => void;
  info: (message: string, options?: LogOptions) => void;
  warn: (message: string, options?: LogOptions) => void;
  error: (message: string, error?: Error, options?: LogOptions) => void;
}

/**
 * Interface for ID generation dependency
 */
export interface IDGenerator {
  generate: () => string;
}

/**
 * Interface for the chat API client
 */
export interface ChatAPIClient {
  streamChatMessages: (options: {
    messages: ExtendedMessage[];
    id: string;
    model: string;
    api: string;
    streamProtocol: StreamProtocol;
    headers: Record<string, string>;
    body: Record<string, any>;
    attachments?: Attachment[];
    getAbortController: () => AbortController;
    onResponse?: (response: Response) => void | Promise<void>;
    onUpdate: (update: {
      message: ExtendedMessage;
      replaceLastMessage: boolean;
    }) => void;
    onStreamPart?: (part: string, delta: any, type: string) => void;
    onFinish: (
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
  }) => Promise<string | null>;
}

/**
 * Combined dependencies interface
 */
export interface HookDependencies {
  logger: Logger;
  idGenerator: IDGenerator;
  chatAPIClient: ChatAPIClient;
}

/**
 * Default implementation of the logger dependency
 */
import defaultLogger from "@/lib/utils/logger";
export const defaultLoggerImpl: Logger = defaultLogger;

/**
 * Default implementation of the ID generator dependency
 */
import { generateUUID } from "@/lib/utils";
export const defaultIDGeneratorImpl: IDGenerator = {
  generate: generateUUID,
};

/**
 * Default implementation of the chat API client
 */
import { streamChatMessages as streamChatMessagesImpl } from "@/lib/chat/chatApi";
export const defaultChatAPIClientImpl: ChatAPIClient = {
  streamChatMessages: streamChatMessagesImpl,
};

/**
 * Default implementations of all dependencies
 */
export const defaultDependencies: HookDependencies = {
  logger: defaultLoggerImpl,
  idGenerator: defaultIDGeneratorImpl,
  chatAPIClient: defaultChatAPIClientImpl,
};
