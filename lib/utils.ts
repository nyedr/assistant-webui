import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Document } from "@/lib/db/schema";
import type { Message } from "ai";

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
  messages: Array<Message>
): Array<Message> {
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

export function getMostRecentUserMessage(messages: Array<Message>) {
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

export function parseChatFromDB(chat: string): {
  currentId: string | null;
  messages: Message[];
} {
  try {
    if (!chat || typeof chat !== "string") {
      console.warn("[utils] Invalid chat data, returning empty chat");
      return { currentId: null, messages: [] };
    }

    const parsed = JSON.parse(chat);

    // Handle older format which had nested "history" property
    if (parsed.history) {
      console.log(
        "[utils] Detected old chat format with history property, migrating"
      );
      return parsed.history;
    }

    // Handle direct message array format (legacy)
    if (Array.isArray(parsed)) {
      console.log(
        "[utils] Detected array format, converting to proper structure"
      );
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
        console.warn("[utils] messages property is not an array, fixing");
        parsed.messages = [];
      }

      // Sanitize all message content
      parsed.messages = parsed.messages.map((msg: any) => ({
        ...msg,
        content: msg.content || "",
      }));

      // Ensure currentId is set correctly
      if (!parsed.currentId && parsed.messages.length > 0) {
        console.log("[utils] Setting missing currentId to last message ID");
        parsed.currentId = parsed.messages[parsed.messages.length - 1].id;
      }
    }

    return {
      currentId: parsed.currentId || null,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (error) {
    console.error("Error parsing chat from DB:", error);
    // Return empty structure in case of error
    return {
      currentId: null,
      messages: [],
    };
  }
}

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
    console.error("Error stringifying chat for DB:", error);
    return JSON.stringify({
      currentId: null,
      messages: [],
    });
  }
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}
// Helper function to format pricing to display pricing per 1M tokens
export const formatPrice = (price: string): string => {
  // Handle special cases for pricing
  if (price === "-1") return "Variable";
  if (price === "0") return "Free";

  const priceNum = parseFloat(price);

  // If price can't be parsed to a number or is invalid
  if (isNaN(priceNum)) return "N/A";

  // If the price is effectively free (very small number)
  if (priceNum < 0.000000000001) return "Free";

  const pricePer1M = priceNum * 1000000;
  return `$${pricePer1M.toFixed(2)}`;
};

// Helper function to format context length with K/M suffix
export const formatContextLength = (length: number | null): string => {
  // Handle null or undefined case
  if (length === null || length === undefined) return "Unknown";

  // Handle edge cases
  if (length <= 0) return "Variable";

  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(1)}M`;
  } else if (length >= 1000) {
    return `${(length / 1000).toFixed(0)}K`;
  }
  return length.toString();
};

// Model selector utility types
export type ModelSortOption = "provider" | "context" | "price";
export type ModalityFilterOption = "all" | "text" | "text+image";
export type ContextSizeFilterOption = "all" | "small" | "medium" | "large";

// Available filter options
export const MODALITY_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "text", label: "Text Only" },
  { value: "text+image", label: "Vision" },
];

export const CONTEXT_SIZE_OPTIONS = [
  { value: "all", label: "Any Size" },
  { value: "small", label: "< 32K" },
  { value: "medium", label: "32K - 128K" },
  { value: "large", label: "≥ 128K" },
];

export const STORAGE_KEYS = {
  MODALITY_FILTER: "model-modality-filter",
  CONTEXT_FILTER: "model-context-filter",
  SORT_BY: "model-sort-by",
};

import type { ModelDisplay } from "@/lib/ai/models";

// Type definition for model groups
export type ModelGroup = {
  provider: string;
  models: ModelDisplay[];
};

// Function to organize models into groups by provider
export function organizeModels(models: ModelDisplay[]): {
  grouped: Record<string, ModelGroup>;
  ungrouped: ModelDisplay[];
} {
  const grouped: Record<string, ModelGroup> = {};
  const ungrouped: ModelDisplay[] = [];

  models.forEach((model: ModelDisplay) => {
    if (model.id.includes("/")) {
      // For models with provider format (e.g., "openai/gpt-4")
      const [provider] = model.id.split("/");
      if (!grouped[provider]) {
        grouped[provider] = {
          provider,
          models: [],
        };
      }
      grouped[provider].models.push(model);
    } else {
      // For models without provider format
      ungrouped.push(model);
    }
  });

  return { grouped, ungrouped };
}

// Function to filter and sort models based on search and filter criteria
export function filterAndSortModels(
  models: ModelDisplay[],
  search: string,
  modalityFilter: ModalityFilterOption,
  contextSizeFilter: ContextSizeFilterOption,
  sortBy: ModelSortOption
): { grouped: Record<string, ModelGroup>; ungrouped: ModelDisplay[] } {
  // Start with all models
  let filteredModels = [...models];

  // Apply search filter
  if (search) {
    const searchLower = search.toLowerCase();

    // First, filter models that match any criteria
    filteredModels = filteredModels.filter(
      (model) =>
        model.label.toLowerCase().includes(searchLower) ||
        model.id.toLowerCase().includes(searchLower) ||
        model.description.toLowerCase().includes(searchLower)
    );

    // Then, sort the results by search relevance
    filteredModels.sort((a, b) => {
      const aLabelLower = a.label.toLowerCase();
      const bLabelLower = b.label.toLowerCase();

      // Exact label match gets highest priority
      if (aLabelLower === searchLower && bLabelLower !== searchLower) return -1;
      if (bLabelLower === searchLower && aLabelLower !== searchLower) return 1;

      // Next, prioritize labels that start with the search term
      const aLabelStartsWith = aLabelLower.startsWith(searchLower);
      const bLabelStartsWith = bLabelLower.startsWith(searchLower);
      if (aLabelStartsWith && !bLabelStartsWith) return -1;
      if (bLabelStartsWith && !aLabelStartsWith) return 1;

      // Then prioritize any label match
      const aLabelMatch = aLabelLower.includes(searchLower);
      const bLabelMatch = bLabelLower.includes(searchLower);
      if (aLabelMatch && !bLabelMatch) return -1;
      if (bLabelMatch && !aLabelMatch) return 1;

      // Then prioritize ID matches
      const aIdLower = a.id.toLowerCase();
      const bIdLower = b.id.toLowerCase();
      const aIdStartsWith = aIdLower.startsWith(searchLower);
      const bIdStartsWith = bIdLower.startsWith(searchLower);

      // ID starts with search term
      if (aIdStartsWith && !bIdStartsWith) return -1;
      if (bIdStartsWith && !aIdStartsWith) return 1;

      // ID contains search term
      const aIdMatch = aIdLower.includes(searchLower);
      const bIdMatch = bIdLower.includes(searchLower);
      if (aIdMatch && !bIdMatch) return -1;
      if (bIdMatch && !aIdMatch) return 1;

      // Description matches come last in priority
      return 0;
    });
  }

  // Apply modality filter
  if (modalityFilter !== "all") {
    filteredModels = filteredModels.filter((model) =>
      model.modality.toLowerCase().includes(modalityFilter.toLowerCase())
    );
  }

  // Apply context size filter
  if (contextSizeFilter !== "all") {
    switch (contextSizeFilter) {
      case "small":
        filteredModels = filteredModels.filter(
          (model) => model.contextLength > 0 && model.contextLength < 32000
        );
        break;
      case "medium":
        filteredModels = filteredModels.filter(
          (model) =>
            model.contextLength >= 32000 && model.contextLength < 128000
        );
        break;
      case "large":
        filteredModels = filteredModels.filter(
          (model) => model.contextLength >= 128000
        );
        break;
    }
  }

  // Sort models
  if (sortBy === "context") {
    // Sort by context size (largest first), handling edge cases like null values
    filteredModels.sort((a, b) => {
      // Handle null/zero/negative values (Variable context)
      if (a.contextLength <= 0 && b.contextLength <= 0) return 0;
      if (a.contextLength <= 0) return 1; // Put variable context at the end
      if (b.contextLength <= 0) return -1;

      return b.contextLength - a.contextLength;
    });
  } else if (sortBy === "price") {
    // Sort by price (cheapest first), handling edge cases
    filteredModels.sort((a, b) => {
      const priceA = a.pricing.completion;
      const priceB = b.pricing.completion;

      // Handle special price values
      if (priceA === "-1" && priceB === "-1") return 0;
      if (priceA === "-1") return 1; // Put variable price at the end
      if (priceB === "-1") return -1;

      // Handle free models
      if (priceA === "0" && priceB === "0") return 0;
      if (priceA === "0") return -1; // Free models first
      if (priceB === "0") return 1;

      // Normal price comparison
      return parseFloat(priceA) - parseFloat(priceB);
    });
  }

  // Organize filtered models
  return organizeModels(filteredModels);
}
