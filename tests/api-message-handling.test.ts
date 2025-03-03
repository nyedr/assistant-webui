import { describe, test, expect, vi, beforeEach } from "vitest";
import { Message, JSONValue } from "ai";
import { generateUUID } from "../lib/utils";

// Mock the database functions
const mockUpdateChatMessages = vi.fn().mockResolvedValue(true);
const mockGetChatById = vi.fn().mockResolvedValue({
  data: {
    chat: JSON.stringify({
      messages: [],
    }),
  },
});

vi.mock("@/app/(chat)/actions", () => ({
  getChatById: mockGetChatById,
  updateChatMessages: mockUpdateChatMessages,
}));

// Extended message type to match application type
interface ExtendedMessage extends Message {
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
}

// API Route simulator
class ApiRouteSimulator {
  // Simulate the POST request handler from the route.ts file
  async handlePostRequest(chatId: string, messages: Message[]): Promise<any> {
    try {
      if (!chatId) {
        return {
          data: null,
          error: "Chat ID is required",
          status: 400,
        };
      }

      // Simulate merging with existing messages
      try {
        const existingChat = await mockGetChatById({ id: chatId });
        if (existingChat.data?.chat) {
          const existingChatData = JSON.parse(existingChat.data.chat);

          if (existingChatData.messages?.length > 0) {
            // Create sets of IDs for efficient lookup
            const incomingIds = new Set(messages.map((m) => m.id));
            const existingMessages = existingChatData.messages;

            // Find messages in DB that aren't in the incoming data
            const missingMessages = existingMessages.filter(
              (m: any) => !incomingIds.has(m.id)
            );

            // Add missing messages if any found
            if (missingMessages.length > 0) {
              messages.push(...missingMessages);

              // Sort by timestamp to maintain order
              messages.sort((a, b) => {
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

      // Process messages with proper relationship handling
      const processedMessages = this.processMessages(messages);

      // Simulate saving to database
      await mockUpdateChatMessages(chatId, processedMessages);

      // Return the updated chat data
      const updatedChat = await mockGetChatById({ id: chatId });
      return updatedChat;
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : "Unknown error",
        status: 500,
      };
    }
  }

  // Helper to process messages (similar to route.ts implementation)
  processMessages(messages: Message[]): Message[] {
    return messages.map((message) => {
      // Extract relationship information from message.data if present
      let parentId: string | null = null;
      let childrenIds: string[] = [];

      // Check for top-level fields
      if ("parent_id" in message) {
        parentId = (message as ExtendedMessage).parent_id || null;
      }

      if ("children_ids" in message) {
        childrenIds = (message as ExtendedMessage).children_ids || [];
      }

      // For compatibility with AI SDK messages that might store relationships in data
      if (message.data && typeof message.data === "object") {
        const data = message.data as Record<string, any>;
        if (
          data.parent_id !== undefined &&
          (parentId === undefined || parentId === null)
        ) {
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
        reasoning: (message as any).reasoning,
        experimental_attachments: (message as any).experimental_attachments,
        data: {
          ...(typeof message.data === "object" && message.data !== null
            ? message.data
            : {}),
          // Remove relationship data from data object to avoid duplication
          parent_id: undefined,
          children_ids: undefined,
        } as unknown as JSONValue,
        annotations: (message as any).annotations,
        toolInvocations: (message as any).toolInvocations,
        // Include parent-child relationship fields at the top level
        parent_id: parentId,
        children_ids: Array.isArray(childrenIds) ? childrenIds : [],
        model:
          message.role === "assistant"
            ? (message as ExtendedMessage).model || "unknown"
            : (message as ExtendedMessage).model,
      } as Message;
    });
  }
}

describe("API Message Handling Tests", () => {
  let apiSimulator: ApiRouteSimulator;

  beforeEach(() => {
    apiSimulator = new ApiRouteSimulator();
    vi.clearAllMocks();

    // Reset mocks
    mockGetChatById.mockResolvedValue({
      data: {
        chat: JSON.stringify({
          messages: [],
        }),
      },
    });
  });

  test("should process messages with correct relationship fields", async () => {
    // Create a full conversation thread with relationships
    const messages: ExtendedMessage[] = [
      // First user message
      {
        id: "user-1",
        role: "user",
        content: "Hello",
        createdAt: new Date(),
        parent_id: null,
        children_ids: ["assistant-1"],
      },
      // First assistant response
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi there!",
        createdAt: new Date(),
        parent_id: "user-1",
        children_ids: ["user-2"],
        model: "test-model",
      },
      // Second user message
      {
        id: "user-2",
        role: "user",
        content: "How are you?",
        createdAt: new Date(),
        parent_id: "assistant-1",
        children_ids: ["assistant-2"],
      },
      // Second assistant response
      {
        id: "assistant-2",
        role: "assistant",
        content: "I'm doing well!",
        createdAt: new Date(),
        parent_id: "user-2",
        children_ids: [],
        model: "test-model",
      },
    ];

    // Process through API simulator
    const processedMessages = apiSimulator.processMessages(messages);

    // Verify relationships are maintained
    expect(processedMessages.length).toBe(4);

    // Check parent-child relationships
    expect(processedMessages[0].id).toBe("user-1");
    expect((processedMessages[0] as ExtendedMessage).parent_id).toBeNull();

    expect(processedMessages[1].id).toBe("assistant-1");
    expect((processedMessages[1] as ExtendedMessage).parent_id).toBe("user-1");

    expect(processedMessages[2].id).toBe("user-2");
    expect((processedMessages[2] as ExtendedMessage).parent_id).toBe(
      "assistant-1"
    );

    expect(processedMessages[3].id).toBe("assistant-2");
    expect((processedMessages[3] as ExtendedMessage).parent_id).toBe("user-2");

    // Check model field preserved
    expect((processedMessages[1] as ExtendedMessage).model).toBe("test-model");
    expect((processedMessages[3] as ExtendedMessage).model).toBe("test-model");
  });

  test("should handle mixed relationship data (in top level and data object)", async () => {
    // Create messages with relationship data in different places
    const messages: Message[] = [
      // User message with relationships at top level
      {
        id: "user-1",
        role: "user",
        content: "Hello",
        createdAt: new Date(),
        parent_id: null,
        children_ids: ["assistant-1"],
      } as ExtendedMessage,
      // Assistant with relationships in data object
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi there",
        createdAt: new Date(),
        data: {
          parent_id: "user-1",
          children_ids: ["user-2"],
        } as unknown as JSONValue,
        model: "test-model",
      } as ExtendedMessage,
    ];

    // Process through API simulator
    const processedMessages = apiSimulator.processMessages(messages);

    // Verify relationships were correctly extracted/normalized
    expect(processedMessages.length).toBe(2);

    // Check parent-child relationships are now at top level
    expect((processedMessages[0] as ExtendedMessage).parent_id).toBeNull();
    expect((processedMessages[1] as ExtendedMessage).parent_id).toBe("user-1");

    // Verify data objects don't contain duplicate relationship data
    const data1 = (processedMessages[1] as any).data;
    expect(data1.parent_id).toBeUndefined();
    expect(data1.children_ids).toBeUndefined();
  });

  test('should default assistant model to "unknown" if none provided', async () => {
    // Create an assistant message with no model
    const messages: Message[] = [
      {
        id: "assistant-no-model",
        role: "assistant",
        content: "Hello",
        createdAt: new Date(),
      } as ExtendedMessage,
    ];

    // Process through API simulator
    const processedMessages = apiSimulator.processMessages(messages);

    // Verify unknown model set
    expect((processedMessages[0] as ExtendedMessage).model).toBe("unknown");
  });

  test("should handle complete POST request flow", async () => {
    const chatId = "test-chat-123";
    const messages: ExtendedMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "Hello",
        createdAt: new Date(),
        parent_id: null,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi there!",
        createdAt: new Date(),
        parent_id: "user-1",
        model: "test-model",
      },
    ];

    // Simulate POST request
    await apiSimulator.handlePostRequest(chatId, messages);

    // Verify database was called with the processed messages
    expect(mockUpdateChatMessages).toHaveBeenCalledTimes(1);
    expect(mockUpdateChatMessages).toHaveBeenCalledWith(
      chatId,
      expect.arrayContaining([
        expect.objectContaining({
          id: "user-1",
          parent_id: null,
        }),
        expect.objectContaining({
          id: "assistant-1",
          parent_id: "user-1",
          model: "test-model",
        }),
      ])
    );
  });

  test("should handle merging with existing messages", async () => {
    // Setup existing messages in the database
    mockGetChatById.mockResolvedValue({
      data: {
        chat: JSON.stringify({
          messages: [
            {
              id: "existing-user-1",
              role: "user",
              content: "Previous message",
              createdAt: new Date("2023-01-01"),
              parent_id: null,
            },
          ],
        }),
      },
    });

    const chatId = "test-chat-with-history";
    const newMessages: ExtendedMessage[] = [
      {
        id: "user-2",
        role: "user",
        content: "Hello",
        createdAt: new Date("2023-01-02"),
        parent_id: null,
      },
    ];

    // Simulate POST request
    await apiSimulator.handlePostRequest(chatId, newMessages);

    // Verify both messages were saved
    expect(mockUpdateChatMessages).toHaveBeenCalledTimes(1);
    expect(mockUpdateChatMessages).toHaveBeenCalledWith(
      chatId,
      expect.arrayContaining([
        expect.objectContaining({
          id: "existing-user-1",
        }),
        expect.objectContaining({
          id: "user-2",
        }),
      ])
    );

    // Verify the database was called with both messages
    const updateCall = mockUpdateChatMessages.mock.calls[0][1];
    expect(updateCall.length).toBe(2);
  });
});
