import { getChatById, updateChatMessages } from "@/app/(chat)/actions";
import { generateUUID } from "@/lib/utils";
import { Message } from "ai";
import { NextRequest } from "next/server";
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
});

const messageArraySchema = z.array(messageSchema);

/**
 * POST handler for saving chat messages
 * This endpoint is specifically designed to save all messages from a conversation
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("id");

    if (!chatId) {
      return Response.json({
        data: null,
        error: "Chat ID is required",
        status: 400,
      });
    }

    // Validate the incoming messages
    const messagesResult = messageArraySchema.safeParse(body);

    if (!messagesResult.success) {
      return Response.json({
        data: null,
        error: messagesResult.error.errors[0].message,
        status: 400,
      });
    }

    const incomingMessages = messagesResult.data;

    // Merge with existing messages to prevent data loss
    try {
      const existingChat = await getChatById({ id: chatId });
      if (existingChat.data?.chat) {
        const existingChatData = JSON.parse(existingChat.data.chat);

        if (existingChatData.messages?.length > 0) {
          // Create sets of IDs for efficient lookup
          const incomingIds = new Set(incomingMessages.map((m) => m.id));
          const existingMessages = existingChatData.messages;

          // Find messages in DB that aren't in the incoming data
          const missingMessages = existingMessages.filter(
            (m: any) => !incomingIds.has(m.id)
          );

          // Add missing messages if any found
          if (missingMessages.length > 0) {
            incomingMessages.push(...missingMessages);

            // Sort by timestamp to maintain order
            incomingMessages.sort((a, b) => {
              const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return aTime - bTime;
            });
          }
        }
      }
    } catch (error) {
      // Continue with the messages we have if there's an error
    }

    // Prepare messages with proper formatting
    const messages = incomingMessages.map(
      (message) =>
        ({
          id: message.id || generateUUID(),
          createdAt: message.createdAt || new Date(),
          role: message.role,
          content: message.content,
          reasoning: message.reasoning,
          experimental_attachments: message.experimental_attachments,
          data: message.data,
          annotations: message.annotations,
          toolInvocations: message.toolInvocations,
        } as Message)
    );

    // Save messages to database
    await updateChatMessages(chatId, messages);

    // Return the updated chat data
    const updatedChat = await getChatById({ id: chatId });
    return Response.json(updatedChat);
  } catch (error) {
    return Response.json({
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    });
  }
}
