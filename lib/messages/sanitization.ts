/**
 * Message Sanitization Utilities
 *
 * This module provides functions for sanitizing and validating messages
 * to ensure they're ready for display or API transmission.
 */

import { Message } from "ai";

/**
 * Removes empty or invalid messages from the response
 * @param messages Array of messages to sanitize
 * @returns Filtered array of valid messages
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
 * @param messages Array of messages to sanitize
 * @returns Filtered array of valid messages
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
 * Sanitizes a chat history object for storage
 * @param history Chat history object with messages
 * @returns Sanitized history object
 */
export function sanitizeChatHistory(history: {
  messages: Message[];
  currentId?: string | null;
  [key: string]: any;
}) {
  // Sanitize message content to remove any unexpected formatting
  const sanitizedMessages = history.messages.map((msg) => ({
    ...msg,
    // Ensure content is a string and trim it
    content:
      typeof msg.content === "string"
        ? msg.content.trim()
        : String(msg.content || ""),
    // Normalize createdAt to ISO string if it's a Date, otherwise keep as is
    createdAt:
      msg.createdAt instanceof Date
        ? msg.createdAt.toISOString()
        : msg.createdAt,
  }));

  return {
    ...history,
    messages: sanitizedMessages,
  };
}

/**
 * General purpose message sanitizer that handles common sanitization needs
 * @param message The message to sanitize
 * @returns Sanitized message
 */
export function sanitizeMessage(message: Message): Message {
  return {
    ...message,
    // Ensure content is trimmed
    content:
      typeof message.content === "string"
        ? message.content.trim()
        : String(message.content || ""),
    // Normalize createdAt but preserve its type (Date or string)
    createdAt:
      message.createdAt instanceof Date
        ? new Date(message.createdAt) // Create a new Date to avoid mutating the original
        : message.createdAt,
  };
}
