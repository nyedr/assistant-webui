import { NextRequest } from "next/server";
import { z } from "zod";

import {
  saveChat,
  getAllChats,
  getChatById,
  deleteChatById,
  updateChatHistory,
  updateChat,
} from "@/app/(chat)/actions";
import { generateUUID } from "@/lib/utils";
import type { ChatMessage, ChatRole } from "@/hooks/use-chat";

// Enhanced validation schemas
const messageSchema = z.object({
  content: z.string(),
  role: z.enum(["system", "user", "assistant", "tool"] as const),
  images: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
});

const messageArraySchema = z.array(messageSchema);

const chatSchema = z.object({
  title: z.string().min(1, "Title is required"),
  folder_id: z.string().nullable().optional(),
  meta: z.record(z.any()).optional(),
});

// Update chat schema
const chatUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  folder_id: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

// GET handlers for chat
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      const chats = await getAllChats();
      return Response.json({
        data: chats,
        error: null,
        status: 200,
      });
    }

    const { data, error, status } = await getChatById({ id });

    if (error) {
      return Response.json({
        data: null,
        error: error.message,
        status,
      });
    }

    return Response.json({
      data,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error in GET /api/chat:", error);
    return Response.json({
      data: null,
      error: "Failed to get chat",
      status: 500,
    });
  }
}

// POST handlers for chat creation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = chatSchema.safeParse(body);

    if (!result.success) {
      return Response.json({
        data: null,
        error: result.error.errors[0].message,
        status: 400,
      });
    }

    const { title, folder_id, meta } = result.data;
    const id = generateUUID();

    await saveChat({
      id,
      title,
      folder_id: folder_id ?? null,
      meta: meta || {},
    });

    const chat = await getChatById({ id });

    return Response.json({
      data: chat.data,
      error: null,
      status: 201,
    });
  } catch (error) {
    console.error("Error in POST /api/chat:", error);
    return Response.json({
      data: null,
      error: "Failed to create chat",
      status: 500,
    });
  }
}

export async function PATCH(request: NextRequest) {
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

    const messagesResult = messageArraySchema.safeParse(body);

    if (!messagesResult.success) {
      return Response.json({
        data: null,
        error: messagesResult.error.errors[0].message,
        status: 400,
      });
    }

    const messages: ChatMessage[] = messagesResult.data.map((message) => ({
      id: generateUUID(),
      role: message.role as ChatRole,
      content: message.content,
      parent_id: null,
      children_ids: [],
      timestamp: Date.now(),
      model: null,
      images: message.images || [],
      files: message.files || [],
      metadata: {},
    }));

    const currentId = messages[messages.length - 1].id;

    await updateChatHistory({
      id: chatId,
      history: {
        currentId,
        messages,
      },
    });

    const chat = await getChatById({ id: chatId });
    return Response.json({
      data: chat.data,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error in PATCH /api/chat:", error);
    return Response.json({
      data: null,
      error: "Failed to update chat",
      status: 500,
    });
  }
}

// Stream response encoder with error handling
function encodeStreamChunk(data: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(data) + "\n");
  } catch (error) {
    console.error("Error encoding stream chunk:", error);
    return new TextEncoder().encode(
      JSON.stringify({ type: "error", content: "Failed to encode chunk" }) +
        "\n"
    );
  }
}

export async function PUT(request: NextRequest) {
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

    const result = chatUpdateSchema.safeParse(body);
    if (!result.success) {
      return Response.json({
        data: null,
        error: result.error.errors[0].message,
        status: 400,
      });
    }

    await updateChat({
      id: chatId,
      ...result.data,
    });

    const chat = await getChatById({ id: chatId });
    return Response.json({
      data: chat.data,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error in PUT /api/chat:", error);
    return Response.json({
      data: null,
      error: "Failed to update chat",
      status: 500,
    });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({
        data: null,
        error: "Chat ID is required",
        status: 400,
      });
    }

    await deleteChatById(id);

    return Response.json({
      data: null,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error in DELETE /api/chat:", error);
    return Response.json({
      data: null,
      error: "Failed to delete chat",
      status: 500,
    });
  }
}
