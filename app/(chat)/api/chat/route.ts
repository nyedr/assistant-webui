import { NextRequest } from "next/server";
import { z } from "zod";
import {
  saveChat,
  getAllChats,
  getChatById,
  deleteChatById,
  updateChat,
} from "@/app/(chat)/actions";
import { generateUUID } from "@/lib/utils";

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

    // Use provided ID if it exists, otherwise generate a new one
    const id = body.id
      ? typeof body.id === "string"
        ? body.id
        : generateUUID()
      : generateUUID();

    console.log(
      `[API] Creating chat with ID: ${id} (${
        body.id ? "provided" : "generated"
      })`
    );

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

    // Check if this is a message update request (array of messages or {currentId, messages} object)
    const isMessageUpdate =
      Array.isArray(body) || (body.messages && Array.isArray(body.messages));

    // If this is a message update, redirect to the dedicated messages endpoint
    if (isMessageUpdate) {
      // Extract the messages array
      const messages = Array.isArray(body) ? body : body.messages;

      // Forward to the dedicated messages endpoint
      const messagesResponse = await fetch(
        `${request.url.split("?")[0]}/messages?id=${chatId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messages),
        }
      );

      return messagesResponse;
    }

    // Otherwise, handle regular chat updates (title, folder, etc.)
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
    console.error("Error in PATCH /api/chat:", error);
    return Response.json({
      data: null,
      error: "Failed to update chat",
      status: 500,
    });
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
