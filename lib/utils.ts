import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Chat, Document } from "@/lib/db/schema";
import type { ChatHistory, ChatMessage, ChatRole } from "@/hooks/use-chat";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ApplicationError extends Error {
  info: string;
  status: number;
}

export const fetcher = async (url: string) => {
  const res = await fetch(url);

  if (!res.ok) {
    const error = new Error(
      "An error occurred while fetching the data."
    ) as ApplicationError;

    error.info = await res.json();
    error.status = res.status;

    throw error;
  }

  return res.json();
};

export function getLocalStorage(key: string) {
  if (typeof window !== "undefined") {
    return JSON.parse(localStorage.getItem(key) || "[]");
  }
  return [];
}

export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validates a UUID string against the standard UUID v4 format
 * @throws Error if UUID is invalid
 */
export function validateUUID(uuid: string): void {
  if (!uuid || typeof uuid !== "string") {
    throw new Error("UUID must be a non-empty string");
  }
  if (uuid.length !== 36) {
    throw new Error(`Invalid UUID length: ${uuid.length} characters`);
  }
  // Check format: 8-4-4-4-12 with valid hex digits
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      uuid
    )
  ) {
    throw new Error(`Invalid UUID format: ${uuid}`);
  }
}

export function sanitizeResponseMessages(
  messages: Array<ChatMessage>
): Array<ChatMessage> {
  return messages.filter((message) => {
    if (message.role !== "assistant") {
      return true;
    }

    return (
      message.content.trim().length > 0 ||
      (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
    );
  });
}

export function sanitizeUIMessages(
  messages: Array<ChatMessage>
): Array<ChatMessage> {
  return messages.filter((message) => {
    if (message.role !== "assistant") {
      return true;
    }

    return (
      message.content.trim().length > 0 ||
      (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
    );
  });
}

export function getMostRecentUserMessage(messages: Array<ChatMessage>) {
  return messages.findLast((message) => message.role === "user");
}

export function getDocumentTimestampByIndex(
  documents: Array<Document>,
  index: number
) {
  if (!documents) return new Date();
  if (index >= documents.length) return new Date();

  return documents[index].createdAt;
}

export function parseChatFromDB(chat: string): ChatHistory {
  return JSON.parse(chat);
}

export function parseChatToDB(chat: ChatHistory): string {
  return JSON.stringify(chat);
}
