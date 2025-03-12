/**
 * Message Query Utilities
 *
 * This module provides functions for finding and querying messages in a conversation.
 */

import { Message } from "ai";

/**
 * Finds the ID of the last user message in the conversation
 * @param messages Array of messages to search
 * @returns The ID of the last user message or null if none found
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
 * Finds the last assistant message in the conversation
 * @param messages Array of messages to search
 * @returns The last assistant message or undefined if none found
 */
export function findLastAssistantMessageId(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      return messages[i].id;
    }
  }
  return null;
}
