import { getChatById, updateChatMessages } from "@/app/(chat)/actions";
import { Message } from "ai";
import { z } from "zod";

// Define the Attachment schema to match the AI SDK type
const AttachmentSchema = z.object({
  name: z.string().optional(),
  type: z.string(),
  data: z.union([z.string(), z.instanceof(Blob)]),
});

// Schema for message validation - aligned with the AI SDK Message type
export const messageSchema = z.object({
  id: z.string(),
  createdAt: z.date().or(z.string()).optional(),
  role: z.enum(["user", "assistant", "system", "data"]),
  content: z.string(),
  reasoning: z.string().optional(),
  experimental_attachments: z.array(AttachmentSchema).optional(),
  data: z.any().optional(),
  annotations: z.array(z.any()).optional(),
  toolInvocations: z.array(z.any()).optional(),
  // Include name for backward compatibility with existing code
  name: z.string().optional(),
  // Add parent-child relationship fields
  parent_id: z.string().nullable().optional(),
  children_ids: z.array(z.string()).optional(),
  model: z.string().optional(),
});

// Type for our validated message from the schema
export type ValidatedMessage = z.infer<typeof messageSchema>;

// Define ExtendedMessage interface
interface ExtendedMessage {
  id: string;
  createdAt: string | Date;
  role: "user" | "assistant" | "system";
  content: string;
  data?: Record<string, any>;
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
  experimental_attachments?: any[];
  annotations?: any[];
  toolInvocations?: any[];
  reasoning?: string;
  parts?: any[];
}

/**
 * POST handler for saving chat messages
 * This endpoint is specifically designed to save all messages from a conversation
 */
export const POST = async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("id");

    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: id" }),
        { status: 400 }
      );
    }

    const json = await request.json();
    const messages = json.messages as ExtendedMessage[];

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing messages array" }),
        { status: 400 }
      );
    }

    // Get the existing chat to merge messages
    const existingChat = await getChatById({ id: chatId });
    let existingMessages: ExtendedMessage[] = [];

    if (
      existingChat &&
      existingChat.data &&
      typeof existingChat.data.chat === "string"
    ) {
      try {
        const chatData = JSON.parse(existingChat.data.chat);
        if (chatData && Array.isArray(chatData.messages)) {
          existingMessages = chatData.messages;
        }
      } catch (e) {
        console.error("Failed to parse existing chat messages:", e);
      }
    }

    // Merge existing messages with new messages, avoiding duplicates
    // Create a map for faster lookup
    const messageMap = new Map<string, ExtendedMessage>();

    // First add existing messages to the map
    existingMessages.forEach((msg) => {
      messageMap.set(msg.id, {
        ...msg,
        // Ensure these fields exist
        children_ids: msg.children_ids || [],
        parent_id: msg.parent_id === undefined ? null : msg.parent_id,
        // For assistant messages, ensure model is set
        model: msg.role === "assistant" ? msg.model || "unknown" : msg.model,
      });
    });

    // Helper to detect duplicate user messages with different IDs but identical properties
    const findDuplicateUserMessage = (
      newMsg: ExtendedMessage
    ): string | null => {
      if (newMsg.role !== "user") return null;

      // Check existing messages for a duplicate based on content and parent_id
      for (const [existingId, existingMsg] of messageMap.entries()) {
        if (
          existingMsg.role === "user" &&
          existingMsg.content === newMsg.content &&
          existingMsg.parent_id === newMsg.parent_id &&
          existingId !== newMsg.id
        ) {
          return existingId;
        }
      }
      return null;
    };

    // Then process new messages, either updating existing ones or adding new ones
    messages.forEach((msg) => {
      const existingMsg = messageMap.get(msg.id);

      // Check if this is potentially a duplicate user message with a different ID
      const duplicateId = findDuplicateUserMessage(msg);

      if (duplicateId) {
        // This message appears to be a duplicate of an existing user message
        console.log(
          `Detected duplicate user message. Original: ${duplicateId}, Duplicate: ${msg.id}`
        );

        // For any messages that have this message as parent, update their parent_id to the original
        for (const [id, message] of messageMap.entries()) {
          if (message.parent_id === msg.id) {
            messageMap.set(id, {
              ...message,
              parent_id: duplicateId,
            });
          }
        }

        // We'll skip adding this message since it's a duplicate
        return;
      }

      if (existingMsg) {
        // When updating existing messages, we need to be careful not to overwrite content
        // For assistant messages, it's critical to preserve the original content
        if (msg.role === "assistant" && existingMsg.role === "assistant") {
          // Only update if the new message actually has content
          const updatedContent = msg.content || existingMsg.content;
          const updatedParts =
            msg.parts && msg.parts.length > 0 ? msg.parts : existingMsg.parts;
          const updatedData =
            msg.data && Object.keys(msg.data).length > 0
              ? msg.data
              : existingMsg.data;

          messageMap.set(msg.id, {
            ...existingMsg,
            ...msg,
            // Preserve content, parts, and data if the new message has empty versions
            content: updatedContent,
            parts: updatedParts || [],
            data: updatedData || {},
            // Preserve children_ids from existing message if not in new message
            children_ids: msg.children_ids || existingMsg.children_ids || [],
            // Ensure parent_id is properly set
            parent_id:
              msg.parent_id === undefined
                ? existingMsg.parent_id
                : msg.parent_id,
            // Keep the original model (or use the new one if provided)
            model: msg.model || existingMsg.model || "unknown",
          });
        } else {
          // For other message types, update normally
          messageMap.set(msg.id, {
            ...existingMsg,
            ...msg,
            // Preserve children_ids from existing message if not in new message
            children_ids: msg.children_ids || existingMsg.children_ids || [],
            // Ensure parent_id is properly set
            parent_id:
              msg.parent_id === undefined
                ? existingMsg.parent_id
                : msg.parent_id,
          });
        }
      } else {
        // Add new message
        messageMap.set(msg.id, {
          ...msg,
          children_ids: msg.children_ids || [],
          parent_id: msg.parent_id === undefined ? null : msg.parent_id,
        });
      }
    });

    // Extract array of all messages from the map
    const allMessages = Array.from(messageMap.values());

    // Create a consistent format for messages, ensuring relationship fields are only at the top level
    const preparedMessages = allMessages.map((message) => {
      // Extract any relationship info from data object if it exists
      const relationshipInfo = {
        parent_id: message.parent_id || (message.data as any)?.parent_id,
        children_ids:
          message.children_ids || (message.data as any)?.children_ids || [],
        model:
          message.role === "assistant"
            ? (message as any).model || "unknown"
            : undefined,
      };

      // Remove duplicate relationship data from the data object if it exists
      const data = { ...message.data };
      if (data && typeof data === "object") {
        delete (data as any).parent_id;
        delete (data as any).children_ids;
        delete (data as any).model;
      }

      // Remove fields that might be causing duplication
      return {
        ...message,
        data,
        ...relationshipInfo,
      };
    });

    // Sort messages chronologically to ensure proper relationship assignment
    const sortedMessages = [...preparedMessages].sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateA.getTime() - dateB.getTime();
    });

    // First pass: Apply basic relationship rules to all messages
    const messagesWithBasicRelationships = sortedMessages.map((message, i) => {
      const messageWithRelationships = { ...message };

      // Initialize children_ids if it doesn't exist
      messageWithRelationships.children_ids =
        messageWithRelationships.children_ids || [];

      // Ensure parent_id is explicitly set to null for the first message
      if (i === 0) {
        messageWithRelationships.parent_id = null;
      } else {
        // Find the most recent message of the opposite role before this message
        let mostRecentOppositeRoleMessage = null;
        for (let j = i - 1; j >= 0; j--) {
          if (sortedMessages[j].role !== message.role) {
            mostRecentOppositeRoleMessage = sortedMessages[j];
            break;
          }
        }

        // If this is an assistant message and we found a user message before it,
        // or this is a user message and we found an assistant message before it,
        // then set the parent_id to that message
        if (mostRecentOppositeRoleMessage) {
          messageWithRelationships.parent_id = mostRecentOppositeRoleMessage.id;
        } else {
          // If no opposite role message found, set parent_id to null
          messageWithRelationships.parent_id = null;
        }
      }

      return messageWithRelationships;
    });

    // Second pass: Update children_ids arrays based on the parent_id values
    // This ensures bidirectional relationships are maintained
    const finalMessages = messagesWithBasicRelationships.map((message) => {
      // Start with a clean children_ids array
      // We'll rebuild it based on who has this message as parent
      return {
        ...message,
        children_ids: [] as string[],
      };
    });

    // Now populate children_ids by looking at parent_id references
    finalMessages.forEach((message) => {
      if (message.parent_id) {
        // Find the parent message
        const parentIndex = finalMessages.findIndex(
          (m) => m.id === message.parent_id
        );
        if (parentIndex !== -1) {
          // Add this message's ID to the parent's children_ids if not already there
          if (!finalMessages[parentIndex].children_ids.includes(message.id)) {
            finalMessages[parentIndex].children_ids.push(message.id);
          }
        }
      }
    });

    // Save the updated messages to the database
    await updateChatMessages(chatId, finalMessages as unknown as Message[]);

    // Fetch the updated chat data
    const updatedChat = await getChatById({ id: chatId });

    if (!updatedChat) {
      return new Response(JSON.stringify({ error: "Failed to update chat" }), {
        status: 500,
      });
    }

    // Return the updated chat data
    return new Response(JSON.stringify(updatedChat), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error updating chat messages:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to update chat messages",
        details: (error as Error).message,
      }),
      { status: 500 }
    );
  }
};
