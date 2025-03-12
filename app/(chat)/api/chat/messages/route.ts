import { z } from "zod";
import { getChatById, updateChatHistory } from "@/app/(chat)/actions";
import { Message } from "ai";
import {
  ExtendedMessage,
  mergeMessages,
  removeDuplicateUserMessages,
  ValidatedMessage,
} from "@/lib/utils/messages";
import { establishMessageRelationships } from "@/lib/messages/relationships";

// Schema for input validation
const messagesPayloadSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
      createdAt: z.union([z.string(), z.date()]),
      parent_id: z.string().nullable().optional(),
      children_ids: z.array(z.string()).optional(),
      model: z.string().optional(),
    })
  ),
  currentId: z.string().nullable().optional(),
});

/**
 * Creates a standard error response with consistent format
 */
function errorResponse(
  message: string,
  status = 400,
  details?: unknown
): Response {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Parses existing chat messages from chat data
 */
function parseExistingMessages(chat: any): ExtendedMessage[] {
  if (!chat || !chat.data || typeof chat.data.chat !== "string") {
    return [];
  }

  try {
    const chatData = JSON.parse(chat.data.chat);
    if (chatData && Array.isArray(chatData.messages)) {
      return chatData.messages;
    }
  } catch (e) {
    console.error("Failed to parse existing chat messages:", e);
  }

  return [];
}

export const POST = async (request: Request) => {
  try {
    // 1. Parse and validate request parameters
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("id");
    if (!chatId) {
      return errorResponse("Missing required parameter: id");
    }

    // 2. Parse and validate request body
    const json = await request.json();
    const validationResult = messagesPayloadSchema.safeParse(json);
    if (!validationResult.success) {
      return errorResponse(
        "Invalid message format",
        400,
        validationResult.error
      );
    }

    const newMessages = validationResult.data.messages as ExtendedMessage[];
    const currentId = validationResult.data.currentId;

    // 3. Retrieve existing messages
    const existingChat = await getChatById({ id: chatId });
    const existingMessages = parseExistingMessages(existingChat);

    // 4. Merge all messages first to ensure we have the complete set
    const allMessages = mergeMessages(existingMessages, newMessages);

    // 5. Deduplicate user messages while maintaining parent-child relationships
    const deduplicatedMessages = removeDuplicateUserMessages(
      allMessages as unknown as ValidatedMessage[]
    ) as unknown as ExtendedMessage[];

    // 6. Establish parent-child relationships again to ensure consistency
    const finalMessages = establishMessageRelationships(deduplicatedMessages);

    // 7. Update the database
    await updateChatHistory({
      id: chatId,
      history: {
        currentId:
          currentId ||
          (finalMessages.length > 0
            ? finalMessages[finalMessages.length - 1].id
            : null),
        messages: finalMessages as unknown as Message[],
      },
    });

    // 8. Return the updated chat
    const updatedChat = await getChatById({ id: chatId });
    if (!updatedChat) {
      return errorResponse("Failed to update chat", 500);
    }

    return new Response(JSON.stringify(updatedChat), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error updating chat messages:", error);
    return errorResponse(
      "Failed to update chat messages",
      500,
      (error as Error).message
    );
  }
};
