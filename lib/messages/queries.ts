/**
 * Message Query Utilities
 *
 * This module provides functions for finding and querying messages in a conversation.
 */

import { Message } from "ai";
import { ExtendedMessage } from "../utils/messages";

/**
 * Returns the most recent user message from the array
 * @param messages Array of messages to search
 * @returns The most recent user message or undefined if none found
 */
export function getMostRecentUserMessage(messages: Array<Message>) {
  return messages.findLast((message) => message.role === "user");
}

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
export function findLastAssistantMessage(messages: Message[]) {
  return messages.findLast((message) => message.role === "assistant");
}

/**
 * Find all user-assistant message pairs in a conversation
 * This is useful for training data extraction or context gathering
 * @param messages The messages to analyze
 * @returns Array of { user, assistant } message pairs
 */
export function findMessagePairs(messages: Message[]): Array<{
  user: Message;
  assistant: Message;
}> {
  const pairs = [];
  let currentUser: Message | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      currentUser = message;
    } else if (message.role === "assistant" && currentUser) {
      pairs.push({
        user: currentUser,
        assistant: message,
      });
      currentUser = null;
    }
  }

  return pairs;
}

/**
 * Find all messages that share the same parent ID
 * This is used for retrieving branches or alternative responses
 * @param messages The full array of messages
 * @param parentId The parent message ID to find children for
 * @returns Array of child messages
 */
export function findChildMessages(
  messages: Message[] | ExtendedMessage[],
  parentId: string
): ExtendedMessage[] {
  return messages.filter(
    (message) => (message as ExtendedMessage).parent_id === parentId
  ) as ExtendedMessage[];
}

/**
 * Check if a message is a descendant of the specified parent ID
 * This is used for branch traversal and filtering
 * @param message The message to check
 * @param possibleAncestorId ID of the possible ancestor
 * @param allMessages All messages in the conversation
 * @returns True if the message is a descendant of the ancestor
 */
export function isMessageDescendantOf(
  message: Message | ExtendedMessage,
  possibleAncestorId: string,
  allMessages: Message[] | ExtendedMessage[]
): boolean {
  // Cast to ExtendedMessage to access parent_id
  const extMessage = message as ExtendedMessage;

  // Base case: direct child
  if (extMessage.parent_id === possibleAncestorId) {
    return true;
  }

  // If no parent, can't be a descendant
  if (!extMessage.parent_id) {
    return false;
  }

  // Find this message's parent
  const parent = allMessages.find((m) => m.id === extMessage.parent_id);
  if (!parent) {
    return false;
  }

  // Recursively check if parent is a descendant of possibleAncestorId
  return isMessageDescendantOf(parent, possibleAncestorId, allMessages);
}
