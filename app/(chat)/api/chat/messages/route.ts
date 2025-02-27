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

    console.log(`[API] Processing message update for chat ${chatId}`);

    // Validate the incoming messages
    const messagesResult = messageArraySchema.safeParse(body);

    if (!messagesResult.success) {
      console.error(
        "[API] Message validation failed:",
        messagesResult.error.errors
      );
      return Response.json({
        data: null,
        error: messagesResult.error.errors[0].message,
        status: 400,
      });
    }

    const incomingMessages = messagesResult.data;

    // Count messages by role for verification and logging
    const userMessages = incomingMessages.filter((m) => m.role === "user");
    const assistantMessages = incomingMessages.filter(
      (m) => m.role === "assistant"
    );

    console.log(
      `[API] Received ${incomingMessages.length} messages (${userMessages.length} user, ${assistantMessages.length} assistant)`
    );

    // For debug, log all message IDs by role
    if (userMessages.length > 0) {
      console.log(
        `[API] User message IDs: ${userMessages.map((m) => m.id).join(", ")}`
      );
    }

    if (assistantMessages.length > 0) {
      console.log(
        `[API] Assistant message IDs: ${assistantMessages
          .map((m) => m.id)
          .join(", ")}`
      );
    }

    // IMPORTANT: Check for database messages to ensure we preserve existing messages
    try {
      const existingChat = await getChatById({ id: chatId });
      if (existingChat.data && existingChat.data.chat) {
        const existingChatData = JSON.parse(existingChat.data.chat);
        if (
          existingChatData.messages &&
          Array.isArray(existingChatData.messages)
        ) {
          const existingUserMessages = existingChatData.messages.filter(
            (m: any) => m.role === "user"
          );

          // Compare with incoming messages to ensure we're not losing any user messages
          const existingUserIds = new Set(
            existingUserMessages.map((m: any) => m.id)
          );
          const incomingUserIds = new Set(userMessages.map((m) => m.id));

          // Find user messages in DB that aren't in the incoming set
          const missingUserMessages = existingUserMessages.filter(
            (m: any) => !incomingUserIds.has(m.id)
          );

          if (missingUserMessages.length > 0) {
            console.warn(
              `[API] Warning: Found ${missingUserMessages.length} user messages in DB that are missing from the incoming request`
            );
            console.warn(
              `[API] Missing user message IDs: ${missingUserMessages
                .map((m: any) => m.id)
                .join(", ")}`
            );

            // Add the missing user messages to our incoming messages array
            incomingMessages.push(...missingUserMessages);

            // Re-sort messages by timestamp if available to maintain chronological order
            incomingMessages.sort((a, b) => {
              const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return aTime - bTime;
            });

            console.log(
              `[API] After merging, we now have ${
                incomingMessages.length
              } messages (${
                incomingMessages.filter((m) => m.role === "user").length
              } user, ${
                incomingMessages.filter((m) => m.role === "assistant").length
              } assistant)`
            );
          }
        }
      }
    } catch (error) {
      console.error("[API] Error checking existing messages:", error);
      // Continue with saving the messages we have
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

    // Use the dedicated updateChatMessages function
    await updateChatMessages(chatId, messages);
    console.log(
      `[API] Successfully updated ${messages.length} messages for chat ${chatId}`
    );

    // Retrieve the updated chat to confirm what was saved
    const chat = await getChatById({ id: chatId });

    // Verify what was actually saved
    if (chat.data && chat.data.chat) {
      try {
        const savedChat = JSON.parse(chat.data.chat);
        const savedUserMessages = savedChat.messages.filter(
          (m: any) => m.role === "user"
        );
        const savedAssistantMessages = savedChat.messages.filter(
          (m: any) => m.role === "assistant"
        );

        console.log(
          `[API] Verified ${savedChat.messages.length} messages saved (${savedUserMessages.length} user, ${savedAssistantMessages.length} assistant)`
        );

        // Check specifically for user message loss
        if (savedUserMessages.length !== userMessages.length) {
          console.warn(
            `[API] User message count mismatch - Sent: ${userMessages.length}, Saved: ${savedUserMessages.length}`
          );

          // Log the specific IDs to help debug
          console.warn(
            `[API] Sent user IDs: ${userMessages.map((m) => m.id).join(", ")}`
          );
          console.warn(
            `[API] Saved user IDs: ${savedUserMessages
              .map((m: any) => m.id)
              .join(", ")}`
          );
        }
      } catch (e) {
        console.error("[API] Error verifying saved messages:", e);
      }
    }

    // Return the updated chat data
    return Response.json(chat);
  } catch (error) {
    console.error("Error updating chat messages:", error);
    return Response.json({
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    });
  }
}
