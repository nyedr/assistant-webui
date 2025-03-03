/**
 * End-to-end test for chat message relationships
 *
 * Purpose:
 * This test verifies that message parent-child relationships are correctly maintained
 * throughout a multi-turn conversation. It ensures the chat system properly establishes
 * and maintains a bidirectional graph of messages through parent_id and children_ids.
 *
 * Chat Message Relationship Model:
 * 1. Each message except the first has exactly one parent message
 * 2. A message's children are stored in its children_ids array
 * 3. If message B has message A as its parent, then A's children_ids must include B
 * 4. First message in a conversation has parent_id: null
 * 5. Assistant messages should have the most recent user message as their parent
 * 6. User messages (after the first) should have the most recent assistant message as their parent
 *
 * This creates a linear chain of alternating user and assistant messages by default:
 * user1 (parent: null) -> assistant1 (parent: user1) -> user2 (parent: assistant1) -> ...
 *
 * Future extensions (not tested here):
 * - Message editing: Creates a branch from the parent of the edited message
 * - Message regeneration: Creates a new assistant message with the same parent as the regenerated message
 */
import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

/**
 * Test utility to query the application's SQLite database
 */
class TestDatabase {
  private db: SqliteDatabase;

  constructor() {
    // Connect to the application's actual database file
    this.db = new Database("data/chat.db");

    // Log the tables in the database for debugging
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    console.log(
      "Available tables in the database:",
      tables.map((table) => (table as { name: string }).name).join(", ")
    );
  }

  /**
   * Gets a chat by ID from the database
   */
  getChatById(chatId: string) {
    const chat = this.db
      .prepare("SELECT * FROM chat WHERE id = ?")
      .get(chatId) as Record<string, any> | undefined;
    if (!chat) return null;

    // Parse the JSON string in the chat column
    if (chat.chat) {
      try {
        chat.chat = JSON.parse(chat.chat);
      } catch (e) {
        console.error("Failed to parse chat JSON", e);
      }
    }

    return chat;
  }

  /**
   * Gets all messages for a chat
   */
  getMessagesForChat(chatId: string) {
    const chat = this.getChatById(chatId) as Record<string, any> | null;
    if (!chat || !chat.chat || !chat.chat.messages) return [];
    return chat.chat.messages;
  }

  /**
   * Comprehensive verification of message relationships in a conversation
   *
   * Verifies:
   * 1. No duplicate message IDs
   * 2. First message has null parent_id
   * 3. Each message has the correct parent based on conversation flow
   * 4. Each parent's children_ids includes its child messages
   * 5. Relationship fields aren't duplicated in the data object
   * 6. All parent_id references point to valid messages
   */
  verifyMessageRelationships(messages: any[]) {
    const result = {
      valid: true,
      issues: [] as string[],
    };

    // Build a map of message IDs for lookup
    const messageMap = new Map();
    messages.forEach((message) => {
      messageMap.set(message.id, message);
    });

    // Check for duplicate messages
    const messageIds = messages.map((m) => m.id);
    const uniqueIds = new Set(messageIds);
    if (uniqueIds.size !== messageIds.length) {
      result.valid = false;
      result.issues.push("Duplicate message IDs detected");
    }

    // Check parent-child relationships
    messages.forEach((message, index) => {
      // First message should have null parent
      if (index === 0) {
        if (message.parent_id !== null) {
          result.valid = false;
          result.issues.push(
            `First message (${message.id}) should have null parent_id but has ${message.parent_id}`
          );
        }
      }
      // For assistant messages, parent should be the last user message
      else if (message.role === "assistant") {
        // Find the most recent user message before this one
        let lastUserMessageId = null;
        for (let i = index - 1; i >= 0; i--) {
          if (messages[i].role === "user") {
            lastUserMessageId = messages[i].id;
            break;
          }
        }

        if (message.parent_id !== lastUserMessageId) {
          result.valid = false;
          result.issues.push(
            `Assistant message ${message.id} should have parent_id ${lastUserMessageId} but has ${message.parent_id}`
          );
        }
      }
      // For user messages (except first), parent should be the last assistant message
      else if (message.role === "user" && index > 0) {
        // Find the most recent assistant message before this one
        let lastAssistantMessageId = null;
        for (let i = index - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") {
            lastAssistantMessageId = messages[i].id;
            break;
          }
        }

        if (message.parent_id !== lastAssistantMessageId) {
          result.valid = false;
          result.issues.push(
            `User message ${message.id} should have parent_id ${lastAssistantMessageId} but has ${message.parent_id}`
          );
        }
      }

      // Check that parent message's children_ids includes this message
      if (message.parent_id !== null) {
        const parentMessage = messageMap.get(message.parent_id);
        if (!parentMessage) {
          result.valid = false;
          result.issues.push(
            `Message ${message.id} references non-existent parent ${message.parent_id}`
          );
        } else if (
          !parentMessage.children_ids ||
          !Array.isArray(parentMessage.children_ids)
        ) {
          result.valid = false;
          result.issues.push(
            `Parent message ${parentMessage.id} has no children_ids array`
          );
        } else if (!parentMessage.children_ids.includes(message.id)) {
          result.valid = false;
          result.issues.push(
            `Parent message ${parentMessage.id} does not include child ${message.id} in its children_ids array`
          );
        }
      }

      // Check that data.parent_id is not present (should be at top level only)
      if (message.data && message.data.parent_id !== undefined) {
        result.valid = false;
        result.issues.push(
          `Message ${message.id} has parent_id in data object, which should be removed`
        );
      }

      // Check that data.children_ids is not present (should be at top level only)
      if (message.data && message.data.children_ids !== undefined) {
        result.valid = false;
        result.issues.push(
          `Message ${message.id} has children_ids in data object, which should be removed`
        );
      }
    });

    return result;
  }

  /**
   * Close the database connection
   */
  close() {
    this.db.close();
  }
}

test.describe("Chat Message Relationships E2E Tests", () => {
  let chatId: string;
  let db: TestDatabase;

  test.beforeAll(async () => {
    // Create a database connection to the application database
    db = new TestDatabase();
  });

  test.afterAll(() => {
    db.close();
  });

  test("maintains proper message relationships through a multi-turn conversation", async ({
    page,
  }) => {
    // Go to home page
    await page.goto("/");

    console.log("Page loaded, waiting for textarea...");

    // Take a screenshot to see what's on the page
    await page.screenshot({ path: "debug-initial-page.png" });

    // Wait for the page to fully load with a longer timeout
    try {
      await page.waitForSelector('textarea[placeholder="Ask anything..."]', {
        timeout: 60000,
      });
      console.log("Textarea found!");
    } catch (error) {
      console.error("Failed to find textarea:", error);
      // Take another screenshot to debug
      await page.screenshot({ path: "debug-textarea-not-found.png" });
      throw error;
    }

    // FIRST EXCHANGE: Initial user message and assistant response
    console.log("Starting first exchange...");
    await page.fill('textarea[placeholder="Ask anything..."]', "Hello");
    await page.press('textarea[placeholder="Ask anything..."]', "Enter");

    // Wait for the AI to respond
    await page.waitForSelector('div[data-message-role="assistant"]', {
      timeout: 60000,
    });
    console.log("First assistant response received");

    // Get the chat ID from localStorage
    chatId = await page.evaluate(() => {
      return sessionStorage.getItem("originalChatId") || "";
    });

    expect(chatId).toBeTruthy();
    console.log("Current chat ID:", chatId);

    // Wait a moment for the messages to be saved to the database
    await page.waitForTimeout(3000);

    // Verify first exchange
    let messages = db.getMessagesForChat(chatId);
    console.log(
      "Messages after first exchange:",
      JSON.stringify(messages, null, 2)
    );

    // Verify we have both the user message and assistant response
    expect(messages.length).toBe(2);
    let validationResult = db.verifyMessageRelationships(messages);
    expect(validationResult.valid, validationResult.issues.join("; ")).toBe(
      true
    );

    // SECOND EXCHANGE: Follow-up user message and assistant response
    console.log("Starting second exchange...");
    await page.fill('textarea[placeholder="Ask anything..."]', "How are you?");
    await page.press('textarea[placeholder="Ask anything..."]', "Enter");

    // Wait for the AI to respond to the second message
    console.log("Waiting for second assistant response...");
    await page.waitForFunction(
      () => {
        return (
          document.querySelectorAll('div[data-message-role="assistant"]')
            .length >= 2
        );
      },
      { timeout: 60000 }
    );
    console.log("Second assistant response received");

    // Wait for the messages to be saved to the database
    await page.waitForTimeout(3000);

    // Verify second exchange
    messages = db.getMessagesForChat(chatId);
    console.log(
      "Messages after second exchange:",
      JSON.stringify(messages, null, 2)
    );

    // We should have 4 messages total (2 user, 2 assistant)
    expect(messages.length).toBe(4);
    validationResult = db.verifyMessageRelationships(messages);
    expect(validationResult.valid, validationResult.issues.join("; ")).toBe(
      true
    );

    // THIRD EXCHANGE: Another follow-up user message and assistant response
    console.log("Starting third exchange...");
    await page.fill(
      'textarea[placeholder="Ask anything..."]',
      "What can you help me with?"
    );
    await page.press('textarea[placeholder="Ask anything..."]', "Enter");

    // Wait for the AI to respond to the third message
    console.log("Waiting for third assistant response...");
    await page.waitForFunction(
      () => {
        return (
          document.querySelectorAll('div[data-message-role="assistant"]')
            .length >= 3
        );
      },
      { timeout: 60000 }
    );
    console.log("Third assistant response received");

    // Wait for the messages to be saved to the database
    await page.waitForTimeout(3000);

    // Verify third exchange
    messages = db.getMessagesForChat(chatId);
    console.log(
      "Messages after third exchange:",
      JSON.stringify(messages, null, 2)
    );

    // We should have 6 messages total (3 user, 3 assistant)
    expect(messages.length).toBe(6);
    validationResult = db.verifyMessageRelationships(messages);

    // If there are any validation issues, log them in detail before failing the test
    if (!validationResult.valid) {
      console.error("Validation issues:", validationResult.issues);

      // Log specific information about problematic messages
      for (const message of messages) {
        if (message.parent_id) {
          const parent = messages.find((m: any) => m.id === message.parent_id);
          if (parent) {
            const parentHasChild =
              parent.children_ids && parent.children_ids.includes(message.id);
            console.log(
              `Message ${message.id} (${message.role}) has parent ${message.parent_id} (${parent.role}), parent has this as child: ${parentHasChild}`
            );
          } else {
            console.log(
              `Message ${message.id} (${message.role}) has parent ${message.parent_id} which doesn't exist in the messages array`
            );
          }
        }
      }
    }

    expect(validationResult.valid, validationResult.issues.join("; ")).toBe(
      true
    );

    // Verify no relationship fields in data objects
    // This ensures the relationship data is stored at the top level of each message
    for (const message of messages) {
      expect(message.data?.parent_id).toBeUndefined();
      expect(message.data?.children_ids).toBeUndefined();
    }
  });
});
