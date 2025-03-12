/**
 * Message Relationship Management
 *
 * This module handles the parent-child relationships between messages in the chat.
 * It provides functions to establish, update, and query these relationships.
 */

import { Message } from "ai";
import { ensureExtendedMessage } from "../utils/messages";

// Import ExtendedMessage type
import type {
  ExtendedChatRequestOptions,
  ExtendedMessage,
} from "../utils/messages";
import { findLastAssistantMessageId, findLastUserMessageId } from "./queries";

export function ensureParentRelationship(
  messages: Message[] | ExtendedMessage[],
  message: ExtendedMessage
) {
  let msgParentId = message.parent_id;
  const msgRole = message.role;

  // DEBUG: Log at start of parent relationship assignment
  console.log("[DEBUG] ensureParentRelationship start:", {
    messageRole: msgRole,
    initialParentId: msgParentId,
    messagesCount: messages.length,
  });

  if (!msgParentId) {
    if (msgRole === "assistant") {
      msgParentId = findLastUserMessageId(messages);
      console.log("[DEBUG] Found parent for assistant message:", msgParentId);
    } else if (msgRole === "user") {
      msgParentId = findLastAssistantMessageId(messages);
      console.log("[DEBUG] Found parent for user message:", msgParentId);

      // DEBUG: Log the last 3 messages in the array to help debug
      if (messages.length > 0) {
        console.log(
          "[DEBUG] Last messages available for finding parent:",
          messages.slice(-3).map((msg) => ({
            id: msg.id,
            role: msg.role,
            timestamp: (msg as ExtendedMessage).createdAt,
          }))
        );
      }
    }
  }

  // DEBUG: Log final parent ID
  console.log("[DEBUG] Final parent_id assigned:", msgParentId);

  return msgParentId;
}

/**
 * Updates parent-child relationships for messages when adding a new message
 * @param currentMessages - The existing array of messages
 * @param message - The new message to add or update
 * @returns Updated array of messages with correct relationships
 */
export function updateMessageRelationships(
  currentMessages: ExtendedMessage[],
  message: ExtendedMessage
): ExtendedMessage[] {
  const msgId = message.id;
  const msgRole = message.role;
  const msgParentId = message.parent_id;

  console.log(
    `[relationships] Updating relationships for ${msgRole} message ${msgId} with parent: ${msgParentId}`
  );

  // Make a copy to avoid modifying the original array
  const messages = [...currentMessages] as ExtendedMessage[];

  // Initialize children_ids if not present
  if (!message.children_ids) {
    message.children_ids = [];
  }

  // If we have a parent ID, add this message to its parent's children_ids
  if (message.parent_id) {
    const parentIndex = messages.findIndex((m) => m.id === message.parent_id);

    if (parentIndex >= 0) {
      const parent = messages[parentIndex];
      const childrenIds = Array.isArray(parent.children_ids)
        ? [...parent.children_ids]
        : [];

      // Add this message to the parent's children if not already there
      if (!childrenIds.includes(message.id)) {
        console.log(
          `[relationships] Adding message ${message.id} to parent ${message.parent_id}'s children_ids`
        );

        // Update the parent message with the new children_ids array
        messages[parentIndex] = {
          ...parent,
          children_ids: [...childrenIds, message.id],
        };
      }
    } else {
      console.warn(
        `[relationships] Warning: Parent message ${message.parent_id} not found for message ${message.id}`
      );
    }
  }

  // Update or add the message
  const messageIndex = messages.findIndex((m) => m.id === message.id);
  if (messageIndex >= 0) {
    messages[messageIndex] = message;
  } else {
    messages.push(message);
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
  message: ExtendedMessage,
  messages: ExtendedMessage[],
  options?: ExtendedChatRequestOptions["options"]
): ExtendedMessage {
  // Create a copy of the message to avoid mutation
  const messageCopy: ExtendedMessage = { ...message };

  // If parent_id is already set, we don't need to calculate it
  if (!messageCopy.parent_id) {
    const parentMessageId = ensureParentRelationship(messages, messageCopy);
    messageCopy.parent_id = parentMessageId;
  }

  // Ensure children_ids is initialized
  if (!messageCopy.children_ids) {
    messageCopy.children_ids = [];
  }

  return {
    ...messageCopy,
    children_ids: messageCopy.children_ids || [],
    // For assistant messages, always set the model
    model:
      message.role === "assistant"
        ? options?.modelId || "unknown"
        : messageCopy.model,
    // Ensure parts is defined for compatibility
    parts: Array.isArray(messageCopy.parts) ? messageCopy.parts : [],
  } as ExtendedMessage;
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
    } else {
      message.parent_id = ensureParentRelationship(messages, message);
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
  options?: ExtendedChatRequestOptions["options"]
): ExtendedMessage[] {
  // Get basic message info for logging
  const msgId = newMessage.id;
  const msgRole = newMessage.role;

  console.log(
    `[relationships] Establishing relationships for ${msgRole} message: ${msgId}`
  );

  // Ensure the new message has extended message properties
  const extendedMessage = ensureExtendedMessage(newMessage as Message);

  // Determine the parent_id if not already set
  if (!extendedMessage.parent_id) {
    extendedMessage.parent_id =
      options?.parentMessageId ||
      ensureParentRelationship(existingMessages, extendedMessage);
  }

  // Initialize children_ids array if needed
  if (!extendedMessage.children_ids) {
    extendedMessage.children_ids = [];
  }

  if (extendedMessage.role === "assistant") {
    extendedMessage.model = options?.modelId || "unknown";
  }

  // Directly use updateMessageRelationships to establish the bidirectional relationship
  return updateMessageRelationships(existingMessages, extendedMessage);
}
