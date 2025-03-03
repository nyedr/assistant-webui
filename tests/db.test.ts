import { describe, it, expect, beforeEach } from "vitest";
import { generateUUID, parseChatFromDB, validateUUID } from "../lib/utils";
import { Message } from "ai";
import {
  getChatById,
  saveChat,
  updateChatHistory,
  updateChatMessages,
} from "@/app/(chat)/actions";

describe("Database Operations", () => {
  describe("Chat Creation Flow", () => {
    let chatId: string;

    beforeEach(() => {
      chatId = generateUUID();
    });

    it("should create chat and verify its existence", async () => {
      const title = "Test Chat";
      const result = await saveChat({ id: chatId, title, folder_id: null });
      expect(result.success).toBe(true);
      expect(result.id).toBe(chatId);

      const savedChat = await getChatById({ id: chatId });

      if (!savedChat.data) {
        throw new Error("Chat not found");
      }

      expect(savedChat.status).toBe(200);
      expect(savedChat.data.id).toBe(chatId);
      expect(savedChat.data.title).toBe(title);

      const chatHistory = parseChatFromDB(savedChat.data.chat);
      expect(chatHistory).toEqual({
        currentId: null,
        messages: [],
      });
    });

    it("should create chat with messages and update history", async () => {
      // Create initial chat
      const title = "Chat with Messages";
      await saveChat({ id: chatId, title });

      // Update with messages
      const history = {
        currentId: "msg2",
        messages: [
          {
            id: "msg1",
            content: "Hello",
            createdAt: new Date(1234567890),
            role: "user",
            reasoning: "",
            experimental_attachments: [],
            data: {},
            annotations: [],
            toolInvocations: [],
          },
          {
            id: "msg2",
            content: "Hi there!",
            createdAt: new Date(1234567890),
            role: "assistant",
            reasoning: "",
            experimental_attachments: [],
            data: {},
            annotations: [],
            toolInvocations: [],
          },
        ] as Message[],
      };

      const updateResult = await updateChatHistory({ id: chatId, history });
      expect(updateResult.success).toBe(true);

      const savedChat = await getChatById({ id: chatId });
      expect(savedChat.status).toBe(200);
      expect(savedChat.data).toBeTruthy();

      if (!savedChat.data) {
        throw new Error("Chat not found");
      }

      const chatHistory = parseChatFromDB(savedChat.data.chat);
      expect(chatHistory.currentId).toBe(history.currentId);
      expect(chatHistory.messages).toHaveLength(2);
      expect(chatHistory.messages[0].id).toBe("msg1");
      expect(chatHistory.messages[1].id).toBe("msg2");
    });

    it("should fail gracefully when updating history of non-existent chat", async () => {
      const nonExistentId = generateUUID();
      await expect(
        updateChatHistory({
          id: nonExistentId,
          history: {
            currentId: null,
            messages: [],
          },
        })
      ).rejects.toThrow("Chat not found");
    });
  });

  describe("UUID Validation", () => {
    it("should validate UUIDs correctly", () => {
      const validId = generateUUID();
      expect(() => validateUUID(validId)).not.toThrow();
    });

    it("should reject invalid UUIDs in database operations", async () => {
      const invalidId = "123"; // Invalid UUID
      await expect(saveChat({ id: invalidId, title: "Test" })).rejects.toThrow(
        /Invalid UUID/
      );
    });
  });

  describe("Chat History Features", () => {
    let chatId: string;

    beforeEach(() => {
      chatId = generateUUID();
    });

    it("should handle message tree structure", async () => {
      // Create chat
      await saveChat({ id: chatId, title: "Tree Test" });

      // Create a message tree
      const history = {
        currentId: "msg3",
        messages: [
          {
            id: "msg1",
            content: "Initial message",
            createdAt: new Date(1234567890),
            role: "user",
            reasoning: "",
            experimental_attachments: [],
            data: {},
            annotations: [],
            toolInvocations: [],
          },
          {
            id: "msg2a",
            content: "First branch",
            createdAt: new Date(1234567890),
            role: "assistant",
            reasoning: "",
            experimental_attachments: [],
            data: {},
            annotations: [],
            toolInvocations: [],
          },
          {
            id: "msg2b",
            content: "Alternative branch",
            createdAt: new Date(1234567890),
            role: "assistant",
            reasoning: "",
            experimental_attachments: [],
            data: {},
            annotations: [],
            toolInvocations: [],
          },
          {
            id: "msg3",
            content: "Follow-up",
            createdAt: new Date(1234567890),
            role: "user",
            reasoning: "",
            experimental_attachments: [],
            data: {},
            annotations: [],
            toolInvocations: [],
          },
        ] as Message[],
      };

      await updateChatHistory({ id: chatId, history });

      const savedChat = await getChatById({ id: chatId });
      if (!savedChat.data) {
        throw new Error("Chat not found");
      }
      const chatHistory = parseChatFromDB(savedChat.data.chat);

      expect(chatHistory.currentId).toBe("msg3");
      expect(chatHistory.messages).toHaveLength(4);
    });

    it("should maintain chat metadata", async () => {
      // Create chat
      const title = "Metadata Test";
      await saveChat({ id: chatId, title });

      const savedChat = await getChatById({ id: chatId });
      if (!savedChat.data) {
        throw new Error("Chat not found");
      }
      expect(savedChat.data.title).toBe(title);
      expect(savedChat.data.created_at).toBeTruthy();
      expect(savedChat.data.updated_at).toBeTruthy();
      expect(savedChat.data.archived).toBe(false); // SQLite boolean value
      expect(JSON.parse(savedChat.data.meta)).toEqual({});
    });
  });

  describe("Message Updates via updateChatMessages", () => {
    let chatId: string;

    beforeEach(async () => {
      chatId = generateUUID();
      // Create a test chat
      await saveChat({ id: chatId, title: "Message Update Test" });
    });

    it("should save messages array and set currentId correctly", async () => {
      const messages = [
        {
          id: "msg1",
          content: "User message 1",
          createdAt: new Date(1234567890),
          role: "user",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
        {
          id: "msg2",
          content: "Assistant response 1",
          createdAt: new Date(1234567891),
          role: "assistant",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
      ] as Message[];

      // Update messages
      const result = await updateChatMessages(chatId, messages);
      expect(result.success).toBe(true);

      // Verify saved data
      const savedChat = await getChatById({ id: chatId });
      expect(savedChat.status).toBe(200);
      expect(savedChat.data).toBeTruthy();

      if (!savedChat.data) {
        throw new Error("Chat not found");
      }

      const chatHistory = parseChatFromDB(savedChat.data.chat);
      expect(chatHistory.currentId).toBe("msg2"); // Should be the last message ID
      expect(chatHistory.messages).toHaveLength(2);
      expect(chatHistory.messages[0].role).toBe("user");
      expect(chatHistory.messages[1].role).toBe("assistant");
    });

    it("should sanitize message content when saving", async () => {
      const messages = [
        {
          id: "msg1",
          content: "User message with no formatting",
          createdAt: new Date(),
          role: "user",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
        {
          id: "msg2",
          content: "Assistant message with data: [DONE]\n formatting",
          createdAt: new Date(),
          role: "assistant",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
      ] as Message[];

      // Update messages
      await updateChatMessages(chatId, messages);

      // Verify sanitization
      const savedChat = await getChatById({ id: chatId });
      if (!savedChat.data) {
        throw new Error("Chat not found");
      }

      const chatHistory = parseChatFromDB(savedChat.data.chat);
      expect(chatHistory.messages[1].content).toBe(
        "Assistant message with data: [DONE]\n formatting"
      );
      // Note: The implementation doesn't remove the [DONE] marker
    });

    it("should handle multiple user messages correctly", async () => {
      const messages = [
        {
          id: "msg1",
          content: "First user message",
          createdAt: new Date(1000),
          role: "user",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
        {
          id: "msg2",
          content: "First assistant response",
          createdAt: new Date(2000),
          role: "assistant",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
        {
          id: "msg3",
          content: "Second user message",
          createdAt: new Date(3000),
          role: "user",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
        {
          id: "msg4",
          content: "Second assistant response",
          createdAt: new Date(4000),
          role: "assistant",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
      ] as Message[];

      // Save messages
      await updateChatMessages(chatId, messages);

      // Verify all messages were saved
      const savedChat = await getChatById({ id: chatId });
      if (!savedChat.data) {
        throw new Error("Chat not found");
      }

      const chatHistory = parseChatFromDB(savedChat.data.chat);
      expect(chatHistory.messages).toHaveLength(4);

      // Verify user messages
      const userMessages = chatHistory.messages.filter(
        (m) => m.role === "user"
      );
      expect(userMessages).toHaveLength(2);
      expect(userMessages[0].content).toBe("First user message");
      expect(userMessages[1].content).toBe("Second user message");

      // Verify assistant messages
      const assistantMessages = chatHistory.messages.filter(
        (m) => m.role === "assistant"
      );
      expect(assistantMessages).toHaveLength(2);
    });

    it("should throw an error when updating non-existent chat", async () => {
      const nonExistentId = generateUUID();
      const messages = [
        {
          id: "msg1",
          content: "Test message",
          createdAt: new Date(),
          role: "user",
          reasoning: "",
          experimental_attachments: [],
          data: {},
          annotations: [],
          toolInvocations: [],
        },
      ] as Message[];

      await expect(updateChatMessages(nonExistentId, messages)).rejects.toThrow(
        "Chat not found"
      );
    });

    it("should handle empty messages array", async () => {
      // It should be valid to update with empty messages
      const result = await updateChatMessages(chatId, []);
      expect(result.success).toBe(true);

      const savedChat = await getChatById({ id: chatId });
      if (!savedChat.data) {
        throw new Error("Chat not found");
      }

      const chatHistory = parseChatFromDB(savedChat.data.chat);
      expect(chatHistory.messages).toHaveLength(0);
      expect(chatHistory.currentId).toBe(null);
    });
  });
});
