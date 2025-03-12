import { Message } from "ai";
import { z } from "zod";
import type { Document } from "@/lib/db/schema";

// Base message schema that can be used for validation
export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  createdAt: z.union([z.string(), z.date()]),
  // Optional fields
  parent_id: z.string().nullable().optional(),
  children_ids: z.array(z.string()).optional(),
  model: z.string().optional(),
  data: z.any().optional(), // Using any() to avoid JSONValue compatibility issues
  experimental_attachments: z.array(z.any()).optional(),
  annotations: z.array(z.any()).optional(),
  toolInvocations: z.array(z.any()).optional(),
  reasoning: z.string().optional(),
  parts: z.array(z.any()).optional(),
});

// Type based on the schema for use throughout the application
export type ValidatedMessage = z.infer<typeof messageSchema>;

// Extended message type with all possible fields
export interface ExtendedMessage extends Message {
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
  parts?: any[];
  data?: any; // Changed to any to match Message's JSONValue type
  experimental_attachments?: any[];
  annotations?: any[];
  toolInvocations?: any[];
  reasoning?: string;
}

// Extended ChatRequestOptions type
export interface ExtendedChatRequestOptions {
  options?: {
    parentMessageId?: string;
    preserveMessageId?: string;
    modelId?: string;
  };
}

/**
 * Sanitizes messages for UI display
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
 * Gets the timestamp for a document at a specific index
 */
export function getDocumentTimestampByIndex(
  documents: Array<Document>,
  index: number
) {
  if (!documents) return new Date();
  if (index >= documents.length) return new Date();

  return documents[index].createdAt;
}

/**
 * Find the message that a response should be to - this is the last user message in the chat
 * @param messages Array of chat messages
 * @returns Message ID of the message being responded to
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
 * Saves chat messages to the database
 * @param chatId The chat ID
 * @param messages Array of messages to save
 * @param currentId Optional ID of the current active message
 * @returns Promise that resolves when save is complete
 */
export async function saveChatMessages(
  chatId: string,
  messages: Message[],
  currentId?: string | null
): Promise<Response> {
  // Final check to ensure all assistant messages have a model
  const sanitizedMessages = messages.map((message) => {
    if (message.role === "assistant") {
      const extMessage = message as ExtendedMessage;
      // If model is null or undefined, set it to "unknown"
      if (!extMessage.model) {
        return {
          ...message,
          model: "unknown",
        };
      }
    }
    return message;
  });

  return fetch(`/api/chat/messages?id=${chatId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: sanitizedMessages,
      currentId:
        currentId ||
        (messages.length > 0 ? messages[messages.length - 1].id : null),
    }),
  });
}

/**
 * Safely converts a standard Message to an ExtendedMessage
 * ensuring all required properties are present
 * @param message The message to convert
 * @returns Message with all ExtendedMessage properties
 */
export function ensureExtendedMessage(message: Message): ExtendedMessage {
  const extendedMessage = message as ExtendedMessage;
  return {
    ...message,
    parent_id: extendedMessage.parent_id || null,
    children_ids: extendedMessage.children_ids || [],
    // For assistant messages, ensure model is never null
    model:
      message.role === "assistant"
        ? extendedMessage.model || "unknown"
        : extendedMessage.model,
    parts: Array.isArray(extendedMessage.parts) ? extendedMessage.parts : [],
  };
}

// TODO: Refactor / remove

// Helper function to process messages and handle branch logic
export function processMessages(
  messages: ValidatedMessage[],
  options?: {
    parentMessageId?: string;
    skipUserMessage?: boolean;
    isBranch?: boolean;
  }
): ValidatedMessage[] {
  // Log the original message count and options
  console.log(`Processing ${messages.length} messages with options:`, options);

  // Check for duplicate user messages with the same content and remove them
  const uniqueMessages = removeDuplicateUserMessages(messages);
  if (uniqueMessages.length !== messages.length) {
    console.log(
      `Removed ${
        messages.length - uniqueMessages.length
      } duplicate user messages`
    );
    messages = uniqueMessages;
  }

  // If this is a branch (retry) request with skipUserMessage flag, we need to filter out
  // the old assistant messages when the parent message ID matches
  if (
    options?.skipUserMessage &&
    options?.parentMessageId &&
    options?.isBranch
  ) {
    console.log("BRANCH REQUEST DETECTED - Processing branch request");
    console.log("Looking for parent message with ID:", options.parentMessageId);

    // Log all message IDs to help debugging
    console.log(
      "Available message IDs:",
      messages.map((m) => `${m.id} (${m.role})`).join(", ")
    );

    // First try: Find the exact parent message by ID
    let parentIndex = messages.findIndex(
      (msg) => msg.id === options.parentMessageId
    );

    // Second try: Try a more flexible string comparison
    if (parentIndex === -1) {
      parentIndex = messages.findIndex(
        (msg) => String(msg.id) === String(options.parentMessageId)
      );
    }

    // Third try: If we still can't find the parent, just keep the conversation up to the last user message
    if (parentIndex === -1) {
      console.log("Parent not found by ID, looking for last user message");
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          parentIndex = i;
          console.log(`Using fallback: last user message at index ${i}`);
          break;
        }
      }
    }

    console.log(`Parent message found at index: ${parentIndex}`);

    if (parentIndex >= 0) {
      // Keep messages up to and including the parent (usually a user message)
      // This effectively removes any previous assistant responses to this user message
      const filteredMessages = messages.slice(0, parentIndex + 1);
      console.log(
        `Filtered to ${filteredMessages.length} messages for branching`
      );

      // Check if we already have a system message
      const hasSystemMessage = filteredMessages.some(
        (msg) => msg.role === "system"
      );

      // For branching, ensure there's a system message that instructs the AI
      // to generate a fresh response
      if (!hasSystemMessage) {
        console.log("Adding system message for branch request");
        filteredMessages.unshift({
          id: "system-message",
          role: "system",
          content:
            "You are a helpful AI assistant. Please provide a new response to the user's message in the same general format and style as a typical assistant response. Do not offer multiple options or explain your thinking process - just respond directly to the user as if this was your first response to them. This is a branch in the conversation where we want a different, but similarly formatted response.",
          createdAt: new Date().toISOString(),
        } as ValidatedMessage);
      }

      // Make sure we have at least one instruction for the model in case of a very short conversation
      // For very short conversations, we might need to add a system message
      if (
        filteredMessages.length === 1 &&
        filteredMessages[0].role === "user"
      ) {
        console.log(
          "Adding system instruction for single-message conversation"
        );
        filteredMessages.unshift({
          id: "system-message",
          role: "system",
          content:
            "You are a helpful AI assistant. Please respond to the user's message.",
          createdAt: new Date().toISOString(),
        } as ValidatedMessage);
      }

      // Take a deep copy to avoid reference issues
      return JSON.parse(JSON.stringify(filteredMessages));
    } else {
      console.log(
        "WARNING: Parent message not found in the message array. Using all messages."
      );
    }
  }

  // Return the filtered ValidatedMessage array (or original if no filtering occurred)
  return messages;
}

// Deduplicate user messages with the same content (keeps the one with children_ids)
export function removeDuplicateUserMessages(
  messages: ValidatedMessage[]
): ValidatedMessage[] {
  const seen = new Map<string, ValidatedMessage>();
  const contentMap = new Map<string, ValidatedMessage[]>();
  const idMap = new Map<string, string>(); // Maps removed ID -> keeper ID

  // Group user messages by content
  messages
    .filter((msg) => msg.role === "user")
    .forEach((msg) => {
      if (!contentMap.has(msg.content)) {
        contentMap.set(msg.content, []);
      }
      contentMap.get(msg.content)!.push(msg);
    });

  // For each content, keep the message with children_ids if possible
  const toRemove = new Set<string>();

  contentMap.forEach((msgs, content) => {
    if (msgs.length > 1) {
      console.log(
        `Found ${msgs.length} user messages with content: "${content.substring(
          0,
          30
        )}..."`
      );

      // Prefer to keep messages with children_ids
      const withChildren = msgs.filter(
        (m) => m.children_ids && m.children_ids.length > 0
      );

      let keeper: ValidatedMessage;

      if (withChildren.length > 0) {
        // Keep the one with most children
        keeper = withChildren.sort(
          (a, b) =>
            (b.children_ids?.length || 0) - (a.children_ids?.length || 0)
        )[0];
      } else {
        // If none have children, keep the most recent one
        keeper = msgs.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
          const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
          return dateB.getTime() - dateA.getTime();
        })[0];
      }

      // Mark others for removal and map their IDs to the keeper
      msgs.forEach((m) => {
        if (m.id !== keeper.id) {
          toRemove.add(m.id);
          idMap.set(m.id, keeper.id); // Map removed ID to keeper ID
          console.log(
            `Marking duplicate user message for removal: ${m.id} -> ${keeper.id}`
          );
        }
      });
    }
  });

  // Process messages before filtering
  // First, gather all children for removed parents
  const keeperChildren = new Map<string, Set<string>>();

  messages.forEach((msg) => {
    if (msg.parent_id && idMap.has(msg.parent_id)) {
      // This message's parent is being removed, reassign to keeper
      const keeperId = idMap.get(msg.parent_id)!;

      if (!keeperChildren.has(keeperId)) {
        keeperChildren.set(keeperId, new Set<string>());
      }

      keeperChildren.get(keeperId)!.add(msg.id);
      console.log(
        `Reassigning child ${msg.id} from ${msg.parent_id} to ${keeperId}`
      );
    }
  });

  // Then create a new array with updated relationships
  const updatedMessages = messages.map((msg) => {
    // If this message is being removed, no need to process further
    if (toRemove.has(msg.id)) return msg;

    // If this message is a keeper that's getting children from removed duplicates
    if (keeperChildren.has(msg.id)) {
      const children = new Set(msg.children_ids || []);

      // Add all reassigned children
      keeperChildren.get(msg.id)!.forEach((childId) => {
        children.add(childId);
      });

      return {
        ...msg,
        children_ids: Array.from(children),
      };
    }

    // If this message's parent was removed, update the parent_id
    if (msg.parent_id && idMap.has(msg.parent_id)) {
      return {
        ...msg,
        parent_id: idMap.get(msg.parent_id),
      };
    }

    // Otherwise keep as is
    return msg;
  });

  // Filter out the messages marked for removal
  return updatedMessages.filter((msg) => !toRemove.has(msg.id));
}

/**
 * Normalizes a message to ensure all expected fields are present
 * with proper defaults
 */
export function normalizeMessage(
  message: Message | Partial<ExtendedMessage>
): ExtendedMessage {
  // Cast to access ExtendedMessage properties safely
  const extMsg = message as Partial<ExtendedMessage>;

  return {
    // Set defaults for required fields
    id: message.id || crypto.randomUUID(),
    role: message.role || "user",
    content: message.content || "",
    createdAt: message.createdAt || new Date().toISOString(),

    // Set defaults for optional fields
    parent_id: extMsg.parent_id === undefined ? null : extMsg.parent_id,
    children_ids: Array.isArray(extMsg.children_ids) ? extMsg.children_ids : [],
    model:
      message.role === "assistant" ? extMsg.model || "unknown" : extMsg.model,
    parts: Array.isArray(extMsg.parts) ? extMsg.parts : [],
  } as ExtendedMessage;
}

/**
 * Merge two collections of messages, handling duplicates intelligently.
 * This is useful when adding new messages to existing ones.
 */
export function mergeMessages(
  existingMessages: ExtendedMessage[] = [],
  newMessages: ExtendedMessage[] = []
): ExtendedMessage[] {
  // Create a map for faster lookup
  const messageMap = new Map<string, ExtendedMessage>();

  // Add existing messages first
  existingMessages.forEach((msg) => {
    messageMap.set(msg.id, normalizeMessage(msg));
  });

  // Process new messages, handling duplicates
  newMessages.forEach((msg) => {
    if (messageMap.has(msg.id)) {
      // Update existing message, preserving non-empty values
      const existingMsg = messageMap.get(msg.id)!;

      // Special handling for assistant messages to preserve model
      if (msg.role === "assistant" && existingMsg.role === "assistant") {
        messageMap.set(msg.id, {
          ...existingMsg,
          ...msg,
          // Preserve non-empty values
          content: msg.content || existingMsg.content,
          children_ids: msg.children_ids || existingMsg.children_ids,
          parent_id: msg.parent_id ?? existingMsg.parent_id,
          // Carefully preserve model information - don't override with undefined
          model:
            existingMsg.model && (!msg.model || msg.model === "unknown")
              ? existingMsg.model // Keep existing model if new one is missing or unknown
              : msg.model || existingMsg.model, // Otherwise use the new model if specified
        });
      } else {
        // For non-assistant messages, update normally
        messageMap.set(msg.id, {
          ...existingMsg,
          ...msg,
          // Preserve non-empty values
          content: msg.content || existingMsg.content,
          children_ids: msg.children_ids || existingMsg.children_ids,
          parent_id: msg.parent_id ?? existingMsg.parent_id,
          model: msg.model || existingMsg.model,
        });
      }
    } else {
      // Add new message
      messageMap.set(msg.id, normalizeMessage(msg));
    }
  });

  return Array.from(messageMap.values());
}

/**
 * Finds duplicates of a user message based on content and parent_id
 */
export function findDuplicateUserMessage(
  messageToCheck: ExtendedMessage,
  messages: ExtendedMessage[]
): string | null {
  if (messageToCheck.role !== "user") return null;

  for (const msg of messages) {
    if (
      msg.role === "user" &&
      msg.content === messageToCheck.content &&
      msg.parent_id === messageToCheck.parent_id &&
      msg.id !== messageToCheck.id
    ) {
      return msg.id;
    }
  }

  return null;
}
