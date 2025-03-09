import { Message } from "ai";

/**
 * Protocol used for streaming chat messages
 */
export type StreamProtocol = "data" | "text";

/**
 * Extended message with additional properties needed for chat
 */
export interface ChatMessage extends Omit<Message, "createdAt"> {
  createdAt: string | Date;
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
}

/**
 * Result of streaming operations
 */
export interface StreamResult {
  messageId: string;
  content: string;
  done: boolean;
}

/**
 * Function to stream chat messages
 */
export type StreamChatMessageFn = (
  messages: Message[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    streamCallback?: (token: string) => void;
    signal?: AbortSignal;
  }
) => Promise<StreamResult>;
