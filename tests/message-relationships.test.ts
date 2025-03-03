import { describe, test, expect, beforeEach, it } from "vitest";
import { Message } from "ai";
import { prepareMessageWithRelationships, generateUUID } from "../lib/utils";

// Mock type extension for Extended Message
interface ExtendedMessage extends Message {
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
}

describe("Message Relationship Tests", () => {
  let messages: Message[];
  const defaultModelId = "test-model-id";

  // Reset messages before each test
  beforeEach(() => {
    messages = [];
  });

  test("first user message should have null parent_id", () => {
    // Create first user message
    const userMessage: ExtendedMessage = {
      id: generateUUID(),
      role: "user",
      content: "Hello",
      createdAt: new Date(),
    };

    const normalizedMessage = prepareMessageWithRelationships(
      userMessage,
      messages,
      defaultModelId
    ) as ExtendedMessage;

    expect(normalizedMessage.parent_id).toBeNull();
    expect(normalizedMessage.children_ids).toEqual([]);
    expect(normalizedMessage.model).toBeUndefined();
  });

  test("assistant message should have most recent user message as parent", () => {
    // Setup: Add a user message first
    const userMessage: ExtendedMessage = {
      id: "user-msg-1",
      role: "user",
      content: "Hello",
      createdAt: new Date(),
    };

    messages.push(userMessage);

    // Create assistant message
    const assistantMessage: ExtendedMessage = {
      id: "assistant-msg-1",
      role: "assistant",
      content: "Hi there",
      createdAt: new Date(),
    };

    const normalizedMessage = prepareMessageWithRelationships(
      assistantMessage,
      messages,
      defaultModelId
    ) as ExtendedMessage;

    expect(normalizedMessage.parent_id).toBe("user-msg-1");
    expect(normalizedMessage.children_ids).toEqual([]);
    expect(normalizedMessage.model).toBe(defaultModelId);
  });

  test("second user message should have most recent assistant message as parent", () => {
    // Setup: Create conversation with user and assistant messages
    const userMessage1: ExtendedMessage = {
      id: "user-msg-1",
      role: "user",
      content: "Hello",
      createdAt: new Date(),
    };

    const assistantMessage1: ExtendedMessage = {
      id: "assistant-msg-1",
      role: "assistant",
      content: "Hi there",
      createdAt: new Date(),
    };

    messages.push(userMessage1, assistantMessage1);

    // Create second user message
    const userMessage2: ExtendedMessage = {
      id: "user-msg-2",
      role: "user",
      content: "How are you?",
      createdAt: new Date(),
    };

    const normalizedMessage = prepareMessageWithRelationships(
      userMessage2,
      messages,
      defaultModelId
    ) as ExtendedMessage;

    expect(normalizedMessage.parent_id).toBe("assistant-msg-1");
    expect(normalizedMessage.children_ids).toEqual([]);
  });

  test("should maintain existing children_ids if present", () => {
    // Setup: Create a message with children_ids
    const userMessage: ExtendedMessage = {
      id: "user-msg-1",
      role: "user",
      content: "Hello",
      createdAt: new Date(),
      children_ids: ["child-1", "child-2"],
    };

    const normalizedMessage = prepareMessageWithRelationships(
      userMessage,
      [],
      defaultModelId
    ) as ExtendedMessage;

    expect(normalizedMessage.children_ids).toEqual(["child-1", "child-2"]);
  });

  test("assistant message should always have model ID", () => {
    const assistantMessage: ExtendedMessage = {
      id: "assistant-msg-1",
      role: "assistant",
      content: "Hello",
      createdAt: new Date(),
    };

    const normalizedMessage = prepareMessageWithRelationships(
      assistantMessage,
      [],
      defaultModelId
    ) as ExtendedMessage;

    expect(normalizedMessage.model).toBe(defaultModelId);
  });

  test('should default to "unknown" model if none provided', () => {
    const assistantMessage: ExtendedMessage = {
      id: "assistant-msg-1",
      role: "assistant",
      content: "Hello",
      createdAt: new Date(),
    };

    const normalizedMessage = prepareMessageWithRelationships(
      assistantMessage,
      [],
      ""
    ) as ExtendedMessage;

    expect(normalizedMessage.model).toBe("unknown");
  });

  // New test: Verifies that relationships are maintained correctly in multi-turn conversations
  it("should maintain proper parent-child relationships in multi-turn conversations", () => {
    // Create a sequence of messages similar to the user's real-world example
    const conversation: ExtendedMessage[] = [];

    // First user message
    const userMessage1: ExtendedMessage = {
      id: "user-1",
      role: "user",
      content: "Hello",
      createdAt: new Date(),
    };

    // Process the first user message
    const processedUserMessage1 = prepareMessageWithRelationships(
      userMessage1,
      conversation,
      "test-model"
    );
    conversation.push(processedUserMessage1);

    // First assistant message
    const assistantMessage1: ExtendedMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Hi there!",
      createdAt: new Date(),
    };

    // Process the first assistant message
    const processedAssistantMessage1 = prepareMessageWithRelationships(
      assistantMessage1,
      conversation,
      "test-model"
    );
    conversation.push(processedAssistantMessage1);

    // Second user message
    const userMessage2: ExtendedMessage = {
      id: "user-2",
      role: "user",
      content: "How are you?",
      createdAt: new Date(),
    };

    // Process the second user message
    const processedUserMessage2 = prepareMessageWithRelationships(
      userMessage2,
      conversation,
      "test-model"
    );
    conversation.push(processedUserMessage2);

    // Second assistant message
    const assistantMessage2: ExtendedMessage = {
      id: "assistant-2",
      role: "assistant",
      content: "I'm doing well, thanks!",
      createdAt: new Date(),
    };

    // Process the second assistant message
    const processedAssistantMessage2 = prepareMessageWithRelationships(
      assistantMessage2,
      conversation,
      "test-model"
    );
    conversation.push(processedAssistantMessage2);

    // Verify the relationships

    // First user message should have null parent_id
    expect(conversation[0].parent_id).toBeNull();

    // First assistant message should point to first user message
    expect(conversation[1].parent_id).toBe("user-1");

    // Second user message should point to first assistant message
    expect(conversation[2].parent_id).toBe("assistant-1");

    // Second assistant message should point to second user message
    expect(conversation[3].parent_id).toBe("user-2");

    // Check that children_ids are updated correctly as well
    // First user message should have first assistant message as child
    expect(conversation[0].children_ids).toContain("assistant-1");

    // First assistant message should have second user message as child
    expect(conversation[1].children_ids).toContain("user-2");

    // Second user message should have second assistant message as child
    expect(conversation[2].children_ids).toContain("assistant-2");
  });
});
