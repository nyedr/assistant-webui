import type { Message } from "ai";

/**
 * Safely retrieves and parses an item from local storage
 * @param key The key to retrieve from localStorage
 * @returns Parsed JSON value or empty array if not found
 */
export function getLocalStorage(key: string) {
  if (typeof window !== "undefined") {
    return JSON.parse(localStorage.getItem(key) || "[]");
  }
  return [];
}

/**
 * Constants for storage keys used throughout the application
 */
export const STORAGE_KEYS = {
  MODALITY_FILTER: "model-modality-filter",
  CONTEXT_FILTER: "model-context-filter",
  SORT_BY: "model-sort-by",
};

/**
 * Parses chat data from the database format
 * Handles various legacy formats and ensures consistent output
 */
export function parseChatFromDB(chat: string): {
  currentId: string | null;
  messages: Message[];
} {
  try {
    if (!chat || typeof chat !== "string") {
      return { currentId: null, messages: [] };
    }

    const parsed = JSON.parse(chat);

    // Handle older format which had nested "history" property
    if (parsed.history) {
      return parsed.history;
    }

    // Handle direct message array format (legacy)
    if (Array.isArray(parsed)) {
      const messages = parsed.map((msg: any) => ({
        ...msg,
        content: msg.content,
      }));
      return {
        currentId:
          messages.length > 0 ? messages[messages.length - 1].id : null,
        messages,
      };
    }

    // Handle current format with currentId and messages
    if (parsed.messages) {
      // Ensure messages is an array
      if (!Array.isArray(parsed.messages)) {
        parsed.messages = [];
      }

      // Sanitize all message content
      parsed.messages = parsed.messages.map((msg: any) => ({
        ...msg,
        content: msg.content || "",
      }));

      // Ensure currentId is set correctly
      if (!parsed.currentId && parsed.messages.length > 0) {
        parsed.currentId = parsed.messages[parsed.messages.length - 1].id;
      }
    }

    return {
      currentId: parsed.currentId || null,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (error) {
    // Return empty structure in case of error
    return {
      currentId: null,
      messages: [],
    };
  }
}

/**
 * Converts chat data to string format for database storage
 */
export function parseChatToDB(history: {
  currentId: string | null;
  messages: Message[];
}): string {
  try {
    // Final sanitize before saving
    const sanitized = {
      currentId: history.currentId,
      messages: history.messages.map((msg) => ({
        ...msg,
        content: msg.content || "",
      })),
    };
    return JSON.stringify(sanitized);
  } catch (error) {
    return JSON.stringify({
      currentId: null,
      messages: [],
    });
  }
}
