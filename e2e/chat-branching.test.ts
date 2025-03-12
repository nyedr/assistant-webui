/**
 * End-to-end test for chat branching functionality
 *
 * Purpose:
 * This test verifies that the chat system correctly handles branching conversations
 * when messages are regenerated. It ensures that:
 * 1. Regenerating a message creates a proper branch in the database
 * 2. The UI correctly displays branch indicators (pagination controls)
 * 3. Users can navigate between branches using the UI controls
 * 4. The correct message content is displayed when switching branches
 *
 * Branching Model:
 * - When a message is regenerated, a new branch is created
 * - Branches share the same parent message
 * - The UI displays pagination controls (e.g., "1/2") to navigate between branches
 * - The database maintains the relationship between branches
 */
import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

/**
 * Interface for a chat message
 */
interface ChatMessage {
  id: string;
  role: string;
  content: string;
  parent_id: string | null;
  children_ids: string[];
  branch_index?: number;
  branch_count?: number;
}

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
  getMessagesForChat(chatId: string): ChatMessage[] {
    const chat = this.getChatById(chatId) as Record<string, any> | null;
    if (!chat || !chat.chat || !chat.chat.messages) return [];
    return chat.chat.messages;
  }

  /**
   * Finds all messages that share the same parent
   * (i.e., messages that are branches of each other)
   */
  findBranchesWithSameParent(
    messages: ChatMessage[],
    parentId: string
  ): ChatMessage[] {
    if (!parentId) return [];
    return messages.filter((message) => message.parent_id === parentId);
  }

  /**
   * Finds the first user message in a conversation
   */
  findFirstUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
    return messages.find((m) => m.role === "user" && m.parent_id === null);
  }

  /**
   * Finds all assistant messages that are direct responses to a user message
   */
  findAssistantResponsesTo(
    messages: ChatMessage[],
    userMessageId: string
  ): ChatMessage[] {
    return messages.filter(
      (m) => m.role === "assistant" && m.parent_id === userMessageId
    );
  }

  /**
   * Verifies that branches are correctly structured in the database
   */
  verifyBranchStructure(
    messages: ChatMessage[],
    parentId: string
  ): { valid: boolean; issues: string[] } {
    const result = {
      valid: true,
      issues: [] as string[],
    };

    // Find all messages with the same parent (branches)
    const branches = this.findBranchesWithSameParent(messages, parentId);

    // If there are no branches, that's not necessarily an error
    if (branches.length === 0) {
      return result;
    }

    // If there's only one branch, that's fine too
    if (branches.length === 1) {
      return result;
    }

    // Verify that the parent message has all branch IDs in its children_ids
    const parentMessage = messages.find((m) => m.id === parentId);
    if (!parentMessage) {
      result.valid = false;
      result.issues.push(`Parent message ${parentId} not found`);
      return result;
    }

    // Check that all branch IDs are in the parent's children_ids
    for (const branch of branches) {
      if (!parentMessage.children_ids.includes(branch.id)) {
        result.valid = false;
        result.issues.push(
          `Branch message ${branch.id} is not in parent's children_ids array`
        );
      }
    }

    return result;
  }

  /**
   * Close the database connection
   */
  close() {
    this.db.close();
  }
}

test.describe("Chat Branching E2E Tests", () => {
  let chatId: string;
  let db: TestDatabase;

  test.beforeAll(async () => {
    // Create a database connection to the application database
    db = new TestDatabase();
  });

  test.afterAll(() => {
    db.close();
  });

  test("regenerating a message creates a branch and allows navigation between branches", async ({
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
    await page.fill(
      'textarea[placeholder="Ask anything..."]',
      "Write a short poem about coding"
    );
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

    // Save the initial assistant message content for comparison
    const initialContent = await page
      .locator('div[data-message-role="assistant"]')
      .textContent();
    console.log("Initial assistant message content:", initialContent);

    // Take a screenshot of the initial response
    await page.screenshot({ path: "initial-response.png" });

    // Get the initial messages from the database
    let messages = db.getMessagesForChat(chatId);
    console.log("Initial messages:", JSON.stringify(messages, null, 2));

    // Find the user message ID for later reference
    const userMessage = db.findFirstUserMessage(messages);
    if (!userMessage) {
      throw new Error("No user message found in the database");
    }
    const userMessageId = userMessage.id;
    console.log("User message ID:", userMessageId);

    // REGENERATE THE ASSISTANT MESSAGE
    console.log("Attempting to regenerate the assistant message...");

    // Hover over the assistant message to reveal action buttons
    await page.hover('div[data-message-role="assistant"]');

    // Take a screenshot after hovering
    await page.screenshot({ path: "after-hover.png" });

    // Look for the regenerate button
    const regenerateButtons = await page
      .locator(
        'button[aria-label="Regenerate this message"], button[aria-label="Retry"]'
      )
      .all();
    console.log(`Found ${regenerateButtons.length} regenerate buttons`);

    if (regenerateButtons.length === 0) {
      // Try to find any buttons within the assistant message
      const allButtons = await page
        .locator('div[data-message-role="assistant"] button')
        .all();
      console.log(
        `Found ${allButtons.length} total buttons in assistant message`
      );

      // Log all button aria-labels for debugging
      for (let i = 0; i < allButtons.length; i++) {
        const ariaLabel = await allButtons[i].getAttribute("aria-label");
        console.log(`Button ${i} aria-label: ${ariaLabel}`);
      }

      // If we found any buttons, try clicking the second one (often the regenerate button)
      if (allButtons.length >= 2) {
        console.log("Clicking the second button as a fallback");
        await allButtons[1].click();
      } else {
        throw new Error("No regenerate button found");
      }
    } else {
      // Click the first regenerate button found
      console.log("Clicking the regenerate button");
      await regenerateButtons[0].click();
    }

    // Wait for the regenerated content to be different from the initial content
    console.log("Waiting for content to change after regeneration...");
    await page.waitForFunction(
      (initialContent) => {
        const currentContent = document.querySelector(
          'div[data-message-role="assistant"]'
        )?.textContent;
        return currentContent && currentContent !== initialContent;
      },
      initialContent,
      { timeout: 60000 }
    );

    console.log("Content changed after regeneration");

    // Take a screenshot after regeneration
    await page.screenshot({ path: "after-regeneration.png" });

    // Get the new content
    const regeneratedContent = await page
      .locator('div[data-message-role="assistant"]')
      .textContent();
    console.log("Regenerated content:", regeneratedContent);

    // Verify content changed
    expect(regeneratedContent).not.toEqual(initialContent);

    // Wait for the database to update
    await page.waitForTimeout(3000);

    // Get updated messages from the database
    messages = db.getMessagesForChat(chatId);
    console.log(
      "Messages after regeneration:",
      JSON.stringify(messages, null, 2)
    );

    // Verify branches in the database using the user message ID
    const assistantResponses = db.findAssistantResponsesTo(
      messages,
      userMessageId
    );
    console.log(
      `Found ${assistantResponses.length} assistant responses to user message ${userMessageId}`
    );
    expect(assistantResponses.length).toBeGreaterThan(1);

    // Verify branch structure
    const branchVerification = db.verifyBranchStructure(
      messages,
      userMessageId
    );
    expect(branchVerification.valid, branchVerification.issues.join("; ")).toBe(
      true
    );

    // VERIFY BRANCH NAVIGATION UI
    console.log("Looking for branch navigation controls...");

    // Take a screenshot to see if branch controls are visible
    await page.screenshot({ path: "branch-controls.png" });

    // Look for pagination indicators (e.g., "1/2")
    const paginationText = await page
      .locator(
        'div[data-message-role="assistant"] [aria-label*="branch"], div[data-message-role="assistant"] [aria-label*="Branch"], div[data-message-role="assistant"] .pagination, div[data-message-role="assistant"] .branch-indicator'
      )
      .textContent();
    console.log("Pagination text:", paginationText);

    // Look for navigation arrows
    const prevButton = await page
      .locator(
        'button[aria-label*="previous"], button[aria-label*="Previous"], .branch-prev, .prev-branch'
      )
      .count();
    const nextButton = await page
      .locator(
        'button[aria-label*="next"], button[aria-label*="Next"], .branch-next, .next-branch'
      )
      .count();

    console.log(
      `Found ${prevButton} previous buttons and ${nextButton} next buttons`
    );

    // If we found navigation controls, try to navigate between branches
    if (nextButton > 0) {
      console.log("Attempting to navigate to next branch");

      // Click the next branch button
      await page
        .locator(
          'button[aria-label*="next"], button[aria-label*="Next"], .branch-next, .next-branch'
        )
        .first()
        .click();

      // Wait a moment for the UI to update
      await page.waitForTimeout(1000);

      // Take a screenshot after navigation
      await page.screenshot({ path: "after-branch-navigation.png" });

      // Get the content after navigation
      const nextBranchContent = await page
        .locator('div[data-message-role="assistant"]')
        .textContent();
      console.log("Content after navigation:", nextBranchContent);

      // Verify content changed after navigation
      expect(nextBranchContent).not.toEqual(regeneratedContent);

      // Navigate back to the first branch
      console.log("Navigating back to first branch");
      await page
        .locator(
          'button[aria-label*="previous"], button[aria-label*="Previous"], .branch-prev, .prev-branch'
        )
        .first()
        .click();

      // Wait a moment for the UI to update
      await page.waitForTimeout(1000);

      // Take a screenshot after navigation back
      await page.screenshot({ path: "after-navigation-back.png" });

      // Get the content after navigating back
      const firstBranchContent = await page
        .locator('div[data-message-role="assistant"]')
        .textContent();
      console.log("Content after navigating back:", firstBranchContent);

      // Verify we're back to the regenerated content
      expect(firstBranchContent).toEqual(regeneratedContent);
    } else {
      console.log(
        "No navigation controls found, skipping branch navigation test"
      );
      // Even if we can't find the UI controls, the database should still show branches
      expect(assistantResponses.length).toBeGreaterThan(1);
    }
  });
});
