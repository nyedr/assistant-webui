import { describe, test, expect, beforeEach, vi } from "vitest";
import { Message, JSONValue } from "ai";
import {
  prepareMessageWithRelationships,
  generateUUID,
  saveChatMessages,
} from "../lib/utils";

// Mock the saveChatMessages function
vi.mock("../lib/utils", async () => {
  const actual = await import("../lib/utils");
  return {
    ...actual,
    saveChatMessages: vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }),
  };
});

// Mock type extension for Extended Message
interface ExtendedMessage extends Message {
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
  parts?: any[];
}

// Mock for the Chat component's functionality
class ChatSimulator {
  messages: ExtendedMessage[] = [];
  chatId: string;
  selectedModelId: string;

  constructor(
    chatId: string = generateUUID(),
    selectedModelId: string = "test-model"
  ) {
    this.chatId = chatId;
    this.selectedModelId = selectedModelId;
  }

  // Simulates handleChatSubmit function
  async handleUserMessage(content: string): Promise<void> {
    // Create user message with a consistent ID
    const userMessage: ExtendedMessage = {
      id: generateUUID(),
      role: "user",
      content,
      createdAt: new Date(),
    };

    // Apply relationships to this message
    const normalizedMessage = prepareMessageWithRelationships(
      userMessage,
      this.messages,
      this.selectedModelId
    ) as ExtendedMessage;

    // Add to messages array (simulates append)
    this.messages.push({
      ...normalizedMessage,
      data: {
        parent_id: normalizedMessage.parent_id,
        children_ids: normalizedMessage.children_ids || [],
      } as unknown as JSONValue,
    });

    return Promise.resolve();
  }

  // Simulates the assistant response
  async simulateAssistantResponse(content: string): Promise<void> {
    // Create assistant message
    const assistantMessage: ExtendedMessage = {
      id: `msg-${generateUUID()}`,
      role: "assistant",
      content,
      createdAt: new Date(),
    };

    // Apply relationship logic
    const normalizedMessage = prepareMessageWithRelationships(
      assistantMessage,
      this.messages,
      this.selectedModelId
    ) as ExtendedMessage;

    // Add to messages
    this.messages.push(normalizedMessage);

    // Simulate saving messages (as done in onFinish)
    const messagesForStorage = this.messages.map((msg) => {
      // Extract any relationship data
      const parentId =
        (msg as ExtendedMessage).parent_id ||
        (msg.data && typeof msg.data === "object" && "parent_id" in msg.data
          ? (msg.data.parent_id as string | null)
          : null);

      const childrenIds =
        (msg as ExtendedMessage).children_ids ||
        (msg.data &&
        typeof msg.data === "object" &&
        "children_ids" in msg.data &&
        Array.isArray(msg.data.children_ids)
          ? (msg.data.children_ids as string[])
          : []);

      return {
        ...msg,
        data: {
          ...(typeof msg.data === "object" && msg.data !== null
            ? msg.data
            : {}),
          parent_id: parentId,
          children_ids: childrenIds,
        } as unknown as JSONValue,
        // Ensure parts is defined to avoid type errors
        parts: (msg as any).parts || [],
      };
    });

    await saveChatMessages(this.chatId, messagesForStorage as Message[]);

    return Promise.resolve();
  }

  // Simulate API route handling of messages for storage
  prepareMessagesForAPI(): ExtendedMessage[] {
    return this.messages.map((message) => {
      // Extract relationship information from message.data if present
      let parentId = message.parent_id;
      let childrenIds = message.children_ids || [];

      // For compatibility with AI SDK messages that might store relationships in data
      if (message.data && typeof message.data === "object") {
        const data = message.data as Record<string, any>;
        if (data.parent_id !== undefined && parentId === undefined) {
          parentId = data.parent_id;
        }
        if (
          Array.isArray(data.children_ids) &&
          (!childrenIds || childrenIds.length === 0)
        ) {
          childrenIds = data.children_ids;
        }
      }

      // Create a consistent message format with top-level relationship fields
      return {
        id: message.id || generateUUID(),
        createdAt: message.createdAt || new Date(),
        role: message.role,
        content: message.content,
        data: {
          ...(typeof message.data === "object" && message.data !== null
            ? message.data
            : {}),
          // Remove relationship data from data object to avoid duplication
          parent_id: undefined,
          children_ids: undefined,
        } as unknown as JSONValue,
        // Include parent-child relationship fields at the top level
        parent_id: parentId !== undefined ? parentId : null,
        children_ids: Array.isArray(childrenIds) ? childrenIds : [],
        model:
          message.role === "assistant"
            ? this.selectedModelId || "unknown"
            : (message as ExtendedMessage).model,
      } as ExtendedMessage;
    });
  }
}

describe("Complete Message Flow Tests", () => {
  let chatSimulator: ChatSimulator;

  beforeEach(() => {
    chatSimulator = new ChatSimulator();
    vi.clearAllMocks();
  });

  test("simulates a complete conversation flow with proper relationships", async () => {
    // First user message
    await chatSimulator.handleUserMessage("Hello");

    // First message should have null parent
    expect(chatSimulator.messages[0].role).toBe("user");
    expect(chatSimulator.messages[0].content).toBe("Hello");
    expect(chatSimulator.messages[0].parent_id).toBeNull();

    // Assistant response
    await chatSimulator.simulateAssistantResponse("Hi there! How can I help?");

    // Assistant should point to user message
    expect(chatSimulator.messages[1].role).toBe("assistant");
    expect(chatSimulator.messages[1].parent_id).toBe(
      chatSimulator.messages[0].id
    );
    expect(chatSimulator.messages[1].model).toBe(chatSimulator.selectedModelId);

    // Second user message
    await chatSimulator.handleUserMessage("I have a question");

    // Second user message should point to assistant
    expect(chatSimulator.messages[2].role).toBe("user");
    expect(chatSimulator.messages[2].parent_id).toBe(
      chatSimulator.messages[1].id
    );

    // Final assistant response
    await chatSimulator.simulateAssistantResponse(
      "Sure, what's your question?"
    );

    // Final assistant message should point to second user message
    expect(chatSimulator.messages[3].role).toBe("assistant");
    expect(chatSimulator.messages[3].parent_id).toBe(
      chatSimulator.messages[2].id
    );

    // Check API formatting
    const apiMessages = chatSimulator.prepareMessagesForAPI();

    // Verify all messages have proper parent_id at top level
    expect(apiMessages[0].parent_id).toBeNull();
    expect(apiMessages[1].parent_id).toBe(chatSimulator.messages[0].id);
    expect(apiMessages[2].parent_id).toBe(chatSimulator.messages[1].id);
    expect(apiMessages[3].parent_id).toBe(chatSimulator.messages[2].id);

    // Verify data properties are correctly handled
    const data0 = apiMessages[0].data as Record<string, any>;
    const data1 = apiMessages[1].data as Record<string, any>;
    const data2 = apiMessages[2].data as Record<string, any>;
    const data3 = apiMessages[3].data as Record<string, any>;

    expect(data0.parent_id).toBeUndefined();
    expect(data1.parent_id).toBeUndefined();
    expect(data2.parent_id).toBeUndefined();
    expect(data3.parent_id).toBeUndefined();

    // saveChatMessages should have been called twice (once for each assistant response)
    expect(saveChatMessages).toHaveBeenCalledTimes(2);
  });

  test("handles edge case of out-of-order messages", async () => {
    // Create a mixed order conversation
    await chatSimulator.handleUserMessage("First user message");

    // Skip assistant response and add second user message
    const secondUserMsg: ExtendedMessage = {
      id: generateUUID(),
      role: "user",
      content: "Second user message without assistant in between",
      createdAt: new Date(),
    };

    // Manually add the message to simulate edge case
    chatSimulator.messages.push(secondUserMsg);

    // Now add assistant response
    await chatSimulator.simulateAssistantResponse("Assistant response");

    // Assistant should point to last user message
    expect(chatSimulator.messages[2].role).toBe("assistant");
    expect(chatSimulator.messages[2].parent_id).toBe(
      chatSimulator.messages[1].id
    );
  });

  test("properly handles model information across message transformations", async () => {
    // Setup a complete conversation
    await chatSimulator.handleUserMessage("Hello");
    await chatSimulator.simulateAssistantResponse("Hi there");

    // Check API transformation preserves model info
    const apiMessages = chatSimulator.prepareMessagesForAPI();

    // User message should not have model
    expect(apiMessages[0].model).toBeUndefined();

    // Assistant message should have model
    expect(apiMessages[1].model).toBe(chatSimulator.selectedModelId);
  });
});
