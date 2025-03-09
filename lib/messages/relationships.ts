/**
 * Message Relationship Management
 *
 * This module handles the parent-child relationships between messages in the chat.
 * It provides functions to establish, update, and query these relationships.
 */

import { Message } from "ai";
import { ensureExtendedMessage } from "../utils/messages";

// Import ExtendedMessage type
import type { ExtendedMessage } from "../utils/messages";

/**
 * Updates parent-child relationships for messages when adding a new message
 * @param currentMessages - The existing array of messages
 * @param message - The new message to add or update
 * @param preservedMessageId - Optional ID of a message to preserve
 * @returns Updated array of messages with correct relationships
 */
export function updateMessageRelationships(
  currentMessages: Message[] | ExtendedMessage[],
  message: Message | ExtendedMessage,
  preservedMessageId?: string
): ExtendedMessage[] {
  // Make a copy to avoid modifying the original array
  const messages = [...currentMessages] as ExtendedMessage[];

  // Ensure message has the extended fields
  const updatedMessage =
    (message as Message).createdAt instanceof Date
      ? ensureExtendedMessage(message as Message)
      : ({
          ...message,
          createdAt: (message as Message).createdAt || new Date(),
        } as ExtendedMessage);

  // If a parent_id is specified and exists in the current messages, update the parent's children
  if (updatedMessage.parent_id) {
    const parentIndex = messages.findIndex(
      (m) => m.id === updatedMessage.parent_id
    );

    if (parentIndex >= 0) {
      const parent = messages[parentIndex];
      const childrenIds = Array.isArray(parent.children_ids)
        ? [...parent.children_ids]
        : [];

      // Add this message to the parent's children if not already there
      if (!childrenIds.includes(updatedMessage.id)) {
        messages[parentIndex] = {
          ...parent,
          children_ids: [...childrenIds, updatedMessage.id],
        } as ExtendedMessage;
      }
    }
  }

  // Update or add the message
  const messageIndex = messages.findIndex((m) => m.id === updatedMessage.id);
  if (messageIndex >= 0) {
    messages[messageIndex] = updatedMessage;
  } else {
    messages.push(updatedMessage);
  }

  return messages;
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
 * Check if a message is a descendant of the specified parent ID
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

/**
 * Processes all messages to ensure proper parent-child relationships are established
 * @param messages Array of messages to process
 * @returns Processed messages with established relationships
 */
export function establishMessageRelationships(
  messages: ExtendedMessage[]
): ExtendedMessage[] {
  if (!messages || messages.length === 0) return [];

  // Create a map of all messages by ID for quick lookup
  const messagesMap = new Map<string, ExtendedMessage>();

  // First pass: register all messages in the map
  messages.forEach((message) => {
    messagesMap.set(message.id, {
      ...message,
      children_ids: message.children_ids || [],
    });
  });

  // Second pass: establish parent-child relationships
  messages.forEach((message) => {
    const extMessage = message as ExtendedMessage;

    // If this message has a parent_id, add this message to parent's children
    if (extMessage.parent_id) {
      const parent = messagesMap.get(extMessage.parent_id);
      if (parent) {
        const childrenIds = parent.children_ids || [];
        if (!childrenIds.includes(message.id)) {
          parent.children_ids = [...childrenIds, message.id];
        }
      }
    }
  });

  // Return the processed messages as an array
  return Array.from(messagesMap.values());
}

/**
 * Main function to establish relationships for a new message in the context of existing messages
 * This consolidates multiple relationship operations into a single function
 *
 * @param existingMessages - Current messages in the conversation
 * @param newMessage - The new message to integrate
 * @param options - Additional options for relationship handling
 * @returns Updated messages array with proper relationships
 */
export function establishRelationshipsForNewMessage(
  existingMessages: ExtendedMessage[],
  newMessage: Message | Partial<ExtendedMessage>,
  options?: {
    modelId?: string;
    preserveMessageId?: string;
  }
): ExtendedMessage[] {
  // Ensure the new message has extended message properties
  const extendedMessage = ensureExtendedMessage(newMessage as Message);

  // Prepare the message with proper relationships if it doesn't have them
  if (!extendedMessage.parent_id && options?.modelId) {
    const preparedMessage = prepareMessageWithRelationships(
      extendedMessage,
      existingMessages,
      options.modelId
    ) as ExtendedMessage;

    // Update relationships in the entire messages array
    return updateMessageRelationships(
      existingMessages,
      preparedMessage,
      options?.preserveMessageId
    );
  }

  // If parent_id is already set or no modelId provided, just update relationships
  return updateMessageRelationships(
    existingMessages,
    extendedMessage,
    options?.preserveMessageId
  );
}
