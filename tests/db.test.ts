import { describe, it, expect, beforeEach } from "vitest";
import { generateUUID, parseChatFromDB } from "../lib/utils";
import { ChatMessage } from "@/hooks/use-chat";
import { getChatById, saveChat, updateChatHistory } from "@/app/(chat)/actions";

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

      const chatHistory = JSON.parse(savedChat.data.chat);
      expect(chatHistory).toEqual({
        history: {
          currentId: null,
          messages: [],
        },
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
            images: [],
            files: [],
            model: "gpt-4",
            role: "user",
            content: "Hello",
            parent_id: null,
            children_ids: ["msg2"],
            timestamp: Date.now(),
          },
          {
            id: "msg2",
            images: [],
            files: [],
            model: "gpt-4",
            role: "assistant",
            content: "Hi there!",
            parent_id: "msg1",
            children_ids: [],
            timestamp: Date.now(),
          },
        ] as ChatMessage[],
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
      expect(() => saveChat({ id: validId, title: "Test" })).not.toThrow();
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
            role: "user",
            images: [],
            files: [],
            model: "gpt-4",
            content: "Initial message",
            parent_id: null,
            children_ids: ["msg2a", "msg2b"],
            timestamp: Date.now(),
          },
          {
            id: "msg2a",
            role: "assistant",
            images: [],
            files: [],
            model: "gpt-4",
            content: "First branch",
            parent_id: "msg1",
            children_ids: ["msg3"],
            timestamp: Date.now(),
          },
          {
            id: "msg2b",
            role: "assistant",
            images: [],
            files: [],
            model: "gpt-4",
            content: "Alternative branch",
            parent_id: "msg1",
            children_ids: [],
            timestamp: Date.now(),
          },
          {
            id: "msg3",
            role: "user",
            images: [],
            files: [],
            model: "gpt-4",
            content: "Follow-up",
            parent_id: "msg2a",
            children_ids: [],
            timestamp: Date.now(),
          },
        ] as ChatMessage[],
      };

      await updateChatHistory({ id: chatId, history });

      const savedChat = await getChatById({ id: chatId });
      if (!savedChat.data) {
        throw new Error("Chat not found");
      }
      const chatHistory = parseChatFromDB(savedChat.data.chat);

      expect(chatHistory.currentId).toBe("msg3");
      expect(chatHistory.messages).toHaveLength(4);
      expect(chatHistory.messages[0].children_ids).toContain("msg2a");
      expect(chatHistory.messages[0].children_ids).toContain("msg2b");
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
});
