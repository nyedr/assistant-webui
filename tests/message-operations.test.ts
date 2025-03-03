import { describe, test, expect, beforeEach } from "vitest";
import { Message, JSONValue } from "ai";

// Extended message type to include relationship data
interface ExtendedMessage extends Message {
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
}

// Message helper functions for testing
class MessageOperations {
  // Extract relationship data from message
  static extractRelationships(message: Message): {
    parentId: string | null;
    childrenIds: string[];
  } {
    let parentId: string | null = null;
    let childrenIds: string[] = [];

    // Check top-level fields first (preferred location)
    if ("parent_id" in message) {
      parentId = (message as ExtendedMessage).parent_id || null;
    }

    if ("children_ids" in message) {
      childrenIds = (message as ExtendedMessage).children_ids || [];
    }

    // Check data object as fallback
    if (message.data && typeof message.data === "object") {
      const data = message.data as Record<string, any>;

      // Only use data.parent_id if top-level field is not set
      if (data.parent_id !== undefined && parentId === null) {
        parentId = data.parent_id;
      }

      // Only use data.children_ids if top-level field is empty
      if (Array.isArray(data.children_ids) && childrenIds.length === 0) {
        childrenIds = data.children_ids;
      }
    }

    return { parentId, childrenIds };
  }

  // Normalize a message by moving relationships to top level
  static normalizeMessage(message: Message): ExtendedMessage {
    const { parentId, childrenIds } = this.extractRelationships(message);
    const typedMessage = message as Record<string, any>;

    // Create a new normalized message with careful typing
    const result: Record<string, any> = {
      id: typedMessage.id,
      role: typedMessage.role,
      content: typedMessage.content,
      createdAt: typedMessage.createdAt,
      parent_id: parentId,
      children_ids: childrenIds,
    };

    // Copy other message properties
    for (const key in typedMessage) {
      if (key !== "data" && key !== "parent_id" && key !== "children_ids") {
        result[key] = typedMessage[key];
      }
    }

    // Handle data property separately to remove relationship fields
    if (message.data) {
      let newData: Record<string, any> = {};

      if (typeof message.data === "object" && message.data !== null) {
        // Copy data properties excluding relationship fields
        const dataObj = message.data as Record<string, any>;
        for (const key in dataObj) {
          if (key !== "parent_id" && key !== "children_ids") {
            newData[key] = dataObj[key];
          }
        }
      } else {
        newData = { value: message.data };
      }

      result.data = newData as JSONValue;
    }

    return result as unknown as ExtendedMessage;
  }

  // Format message for storage, ensuring relationships are in both places (for compatibility)
  static formatForStorage(message: Message): ExtendedMessage {
    const { parentId, childrenIds } = this.extractRelationships(message);
    const typedMessage = message as Record<string, any>;

    // Create a new message with careful typing
    const result: Record<string, any> = {
      id: typedMessage.id,
      role: typedMessage.role,
      content: typedMessage.content,
      createdAt: typedMessage.createdAt,
      parent_id: parentId,
      children_ids: childrenIds,
    };

    // Copy other message properties
    for (const key in typedMessage) {
      if (key !== "data" && key !== "parent_id" && key !== "children_ids") {
        result[key] = typedMessage[key];
      }
    }

    // Create data property with relationship data included
    const newData: Record<string, any> = {
      parent_id: parentId,
      children_ids: childrenIds,
    };

    // Copy existing data properties
    if (
      message.data &&
      typeof message.data === "object" &&
      message.data !== null
    ) {
      const dataObj = message.data as Record<string, any>;
      for (const key in dataObj) {
        if (key !== "parent_id" && key !== "children_ids") {
          newData[key] = dataObj[key];
        }
      }
    }

    result.data = newData as JSONValue;
    return result as unknown as ExtendedMessage;
  }

  // Update parent-child relationships based on conversation flow
  static updateRelationships(messages: ExtendedMessage[]): ExtendedMessage[] {
    if (messages.length <= 1) return [...messages];

    const updatedMessages = [...messages];

    // Update parent_id values based on conversation flow
    for (let i = 1; i < updatedMessages.length; i++) {
      const currentMsg = updatedMessages[i];
      const prevMsg = updatedMessages[i - 1];

      // Assistant messages point to the last user message
      if (currentMsg.role === "assistant") {
        // Look backward for a user message
        for (let j = i - 1; j >= 0; j--) {
          if (updatedMessages[j].role === "user") {
            currentMsg.parent_id = updatedMessages[j].id;
            break;
          }
        }
      }
      // User messages point to the last assistant message
      else if (currentMsg.role === "user") {
        // Look backward for an assistant message
        for (let j = i - 1; j >= 0; j--) {
          if (updatedMessages[j].role === "assistant") {
            currentMsg.parent_id = updatedMessages[j].id;
            break;
          }
        }
      }
    }

    // Update children_ids based on parent_id values
    const childrenMap = new Map<string, string[]>();

    for (const msg of updatedMessages) {
      if (msg.parent_id) {
        const children = childrenMap.get(msg.parent_id) || [];
        children.push(msg.id);
        childrenMap.set(msg.parent_id, children);
      }
    }

    // Assign children_ids to messages
    for (const msg of updatedMessages) {
      msg.children_ids = childrenMap.get(msg.id) || [];
    }

    return updatedMessages;
  }
}

describe("Message Operations Tests", () => {
  let sampleMessages: ExtendedMessage[];

  beforeEach(() => {
    // Create a sample conversation
    sampleMessages = [
      // First user message
      {
        id: "user-1",
        role: "user",
        content: "Hello",
        createdAt: new Date(),
      },
      // First assistant response
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi there!",
        createdAt: new Date(),
        model: "test-model",
      },
      // Second user message
      {
        id: "user-2",
        role: "user",
        content: "How are you?",
        createdAt: new Date(),
      },
    ];
  });

  test("extractRelationships should handle relationship data from both locations", () => {
    // Message with top-level relationship data
    const topLevelMessage: ExtendedMessage = {
      id: "msg-1",
      role: "user",
      content: "Hello",
      createdAt: new Date(),
      parent_id: "parent-msg",
      children_ids: ["child-1", "child-2"],
    };

    // Message with data object relationship data
    const dataObjectMessage: Message = {
      id: "msg-2",
      role: "assistant",
      content: "Hi",
      createdAt: new Date(),
      data: {
        parent_id: "parent-msg",
        children_ids: ["child-1", "child-2"],
      } as unknown as JSONValue,
    };

    // Message with relationship data in both places
    const mixedMessage: ExtendedMessage = {
      id: "msg-3",
      role: "user",
      content: "Test",
      createdAt: new Date(),
      parent_id: "top-level-parent",
      children_ids: ["top-child-1"],
      data: {
        parent_id: "data-parent",
        children_ids: ["data-child-1"],
      } as unknown as JSONValue,
    };

    // Extract relationships
    const topLevelResult =
      MessageOperations.extractRelationships(topLevelMessage);
    const dataObjectResult =
      MessageOperations.extractRelationships(dataObjectMessage);
    const mixedResult = MessageOperations.extractRelationships(mixedMessage);

    // Verify top level message extraction
    expect(topLevelResult.parentId).toBe("parent-msg");
    expect(topLevelResult.childrenIds).toEqual(["child-1", "child-2"]);

    // Verify data object message extraction
    expect(dataObjectResult.parentId).toBe("parent-msg");
    expect(dataObjectResult.childrenIds).toEqual(["child-1", "child-2"]);

    // Verify mixed message extraction (top level should take precedence)
    expect(mixedResult.parentId).toBe("top-level-parent");
    expect(mixedResult.childrenIds).toEqual(["top-child-1"]);
  });

  test("normalizeMessage should move relationships to top level only", () => {
    // Create a message with data object relationship data
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      content: "Hello",
      createdAt: new Date(),
      data: {
        parent_id: "parent-msg",
        children_ids: ["child-1", "child-2"],
        otherData: "should keep this",
      } as unknown as JSONValue,
    };

    // Normalize the message
    const normalized = MessageOperations.normalizeMessage(message);

    // Verify relationships moved to top level
    expect(normalized.parent_id).toBe("parent-msg");
    expect(normalized.children_ids).toEqual(["child-1", "child-2"]);

    // Verify data object doesn't have relationship fields anymore
    const data = normalized.data as Record<string, any>;
    expect(data.parent_id).toBeUndefined();
    expect(data.children_ids).toBeUndefined();

    // Verify other data is preserved
    expect(data.otherData).toBe("should keep this");
  });

  test("formatForStorage should include relationships in both places", () => {
    // Create a message with top-level relationship data
    const message: ExtendedMessage = {
      id: "msg-1",
      role: "user",
      content: "Hello",
      createdAt: new Date(),
      parent_id: "parent-msg",
      children_ids: ["child-1"],
      data: {
        otherData: "test",
      } as unknown as JSONValue,
    };

    // Format for storage
    const formatted = MessageOperations.formatForStorage(message);

    // Verify top level relationships preserved
    expect(formatted.parent_id).toBe("parent-msg");
    expect(formatted.children_ids).toEqual(["child-1"]);

    // Verify relationships added to data object
    const data = formatted.data as Record<string, any>;
    expect(data.parent_id).toBe("parent-msg");
    expect(data.children_ids).toEqual(["child-1"]);

    // Verify other data preserved
    expect(data.otherData).toBe("test");
  });

  test("updateRelationships should establish correct parent-child relationships", () => {
    // Update relationships based on message order/role
    const updatedMessages =
      MessageOperations.updateRelationships(sampleMessages);

    // Verify parent relationships
    expect(updatedMessages[0].parent_id).toBeUndefined(); // First message has no parent
    expect(updatedMessages[1].parent_id).toBe("user-1"); // Assistant points to first user
    expect(updatedMessages[2].parent_id).toBe("assistant-1"); // User points to assistant

    // Verify child relationships
    expect(updatedMessages[0].children_ids).toEqual(["assistant-1"]);
    expect(updatedMessages[1].children_ids).toEqual(["user-2"]);
    expect(updatedMessages[2].children_ids).toEqual([]);
  });

  test("updateRelationships should handle multiple messages of the same role in sequence", () => {
    // Create a conversation with consecutive user messages
    const messagesWithConsecutiveUsers: ExtendedMessage[] = [
      { id: "user-1", role: "user", content: "Hello", createdAt: new Date() },
      {
        id: "user-2",
        role: "user",
        content: "Follow-up",
        createdAt: new Date(),
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi",
        createdAt: new Date(),
      },
    ];

    // Update relationships
    const updated = MessageOperations.updateRelationships(
      messagesWithConsecutiveUsers
    );

    // Second user message should not have a parent (no assistant before it)
    expect(updated[1].parent_id).toBeUndefined();

    // Assistant should point to the most recent user message
    expect(updated[2].parent_id).toBe("user-2");
  });

  test("complete workflow from creation to storage should maintain relationship integrity", () => {
    // Start with raw messages without relationships
    const rawMessages = sampleMessages.map((msg) => ({
      ...msg,
      parent_id: undefined,
      children_ids: undefined,
    }));

    // Step 1: Update relationships based on conversation flow
    const withRelationships =
      MessageOperations.updateRelationships(rawMessages);

    // Step 2: Format each message for storage
    const storageReady = withRelationships.map((msg) =>
      MessageOperations.formatForStorage(msg)
    );

    // Step 3: Simulate API processing by normalizing
    const normalized = storageReady.map((msg) =>
      MessageOperations.normalizeMessage(msg)
    );

    // Verify final result has correct relationships
    // First message doesn't have parent, so it will be undefined or null
    expect([undefined, null]).toContain(normalized[0].parent_id);
    expect(normalized[1].parent_id).toBe("user-1");
    expect(normalized[2].parent_id).toBe("assistant-1");

    expect(normalized[0].children_ids).toEqual(["assistant-1"]);
    expect(normalized[1].children_ids).toEqual(["user-2"]);
    expect(normalized[2].children_ids).toEqual([]);

    // Verify no duplicate data
    for (const msg of normalized) {
      const data = msg.data as Record<string, any>;
      expect(data.parent_id).toBeUndefined();
      expect(data.children_ids).toBeUndefined();
    }
  });
});
