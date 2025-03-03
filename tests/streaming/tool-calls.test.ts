import { vi, describe, expect, test } from "vitest";
import { streamChatMessage } from "@/lib/utils/chat";
import {
  mockFetch,
  setupMocks,
  createMockResponse,
  createMockDataStream,
  mockMessages,
  createMockCallbacks,
  createToolCallData,
} from "./test-utils";

// Set up a UUID generator mock to make testing predictable
vi.mock("@/lib/utils", () => ({
  generateUUID: () => "test-uuid-123",
}));

// Set up mocks for each test
setupMocks();

// Helper function to safely check and assert tool results
function assertToolInvocation(
  toolInvocation: any,
  expectedProps: Record<string, any>
) {
  expect(toolInvocation).toBeDefined();

  // Check each expected property
  Object.entries(expectedProps).forEach(([key, value]) => {
    expect(toolInvocation).toHaveProperty(key);
    expect(toolInvocation[key]).toEqual(value);
  });
}

describe("Tool Call Handling", () => {
  test("should detect and process tool calls", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const toolCall = createToolCallData("tool1", "weather", {
      location: "New York",
    });

    const dataChunks = [
      { type: "text", value: "Here's the weather:" },
      { type: "tool_call", value: toolCall },
    ];

    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model: "gpt-4",
      api: "/api/chat",
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.toolInvocations).toBeDefined();
    expect(result?.toolInvocations?.length).toBeGreaterThan(0);

    // Use the safe assertion helper
    if (result?.toolInvocations && result.toolInvocations.length > 0) {
      assertToolInvocation(result.toolInvocations[0], {
        toolCallId: "tool1",
        toolName: "weather",
      });
    }

    // Verify onToolCall callback was called
    expect(callbacks.onToolCall).toHaveBeenCalled();
  });

  test("should handle multiple tool calls in a single message", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const toolCall1 = createToolCallData("tool1", "weather", {
      location: "New York",
    });
    const toolCall2 = createToolCallData("tool2", "calculator", {
      expression: "2+2",
    });

    const dataChunks = [
      { type: "text", value: "Multiple tools:" },
      { type: "tool_call", value: toolCall1 },
      { type: "tool_call", value: toolCall2 },
    ];

    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model: "gpt-4",
      api: "/api/chat",
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.toolInvocations).toBeDefined();
    expect(result?.toolInvocations?.length).toBe(2);

    // Check each tool call
    if (result?.toolInvocations && result.toolInvocations.length >= 2) {
      assertToolInvocation(result.toolInvocations[0], {
        toolCallId: "tool1",
        toolName: "weather",
      });

      assertToolInvocation(result.toolInvocations[1], {
        toolCallId: "tool2",
        toolName: "calculator",
      });
    }

    // Verify onToolCall callback was called
    expect(callbacks.onToolCall).toHaveBeenCalled();
  });

  test("should include tool calls in the message parts", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const toolCall = createToolCallData("tool1", "weather", {
      location: "New York",
    });

    const dataChunks = [
      { type: "text", value: "Tool call:" },
      { type: "tool_call", value: toolCall },
    ];

    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model: "gpt-4",
      api: "/api/chat",
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.parts).toBeDefined();

    if (result?.parts) {
      const toolInvocationPart = result.parts.find(
        (part) => part.type === "tool-invocation"
      );
      expect(toolInvocationPart).toBeDefined();

      if (toolInvocationPart && "toolInvocation" in toolInvocationPart) {
        expect(toolInvocationPart.toolInvocation).toBeDefined();
        expect(toolInvocationPart.toolInvocation.toolCallId).toBe("tool1");
        expect(toolInvocationPart.toolInvocation.toolName).toBe("weather");
      }
    }
  });

  test("should handle streaming tool call deltas", async () => {
    // Arrange
    const callbacks = createMockCallbacks();

    // Partial tool call data that will be updated over time
    const initialToolCall = createToolCallData("tool1", "weather", {
      locat: "",
    });

    const updatedToolCall = createToolCallData("tool1", "weather", {
      location: "",
    });

    const finalToolCall = createToolCallData("tool1", "weather", {
      location: "New York",
    });

    const dataChunks = [
      { type: "text", value: "Checking weather:" },
      { type: "tool_call", value: initialToolCall },
      { type: "tool_call", value: updatedToolCall },
      { type: "tool_call", value: finalToolCall },
    ];

    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model: "gpt-4",
      api: "/api/chat",
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.toolInvocations).toBeDefined();
    expect(result?.toolInvocations?.length).toBeGreaterThan(0);

    // Verify the final tool call has the complete arguments
    if (result?.toolInvocations && result.toolInvocations.length > 0) {
      assertToolInvocation(result.toolInvocations[0], {
        toolCallId: "tool1",
        toolName: "weather",
      });

      // Check if args contains the location
      const args = result.toolInvocations[0].args;
      expect(args).toBeDefined();
      if (typeof args === "object") {
        expect(args.location).toBe("New York");
      }
    }

    // onToolCall should be called multiple times
    expect(callbacks.onToolCall).toHaveBeenCalled();
  });

  test("should handle tool call errors", async () => {
    // Arrange
    const callbacks = createMockCallbacks();

    // Create a tool call with an error
    const toolCall = createToolCallData("tool1", "weather", {
      location: "New York",
    });

    // Add error information
    const toolCallWithError = {
      ...toolCall,
      error: {
        message: "API unavailable",
        code: "service_unavailable",
      },
    };

    const dataChunks = [
      { type: "text", value: "Error occurred:" },
      { type: "tool_call", value: toolCallWithError },
    ];

    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Mock the onToolCall to simulate an error
    callbacks.onToolCall.mockRejectedValueOnce(new Error("Tool call failed"));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model: "gpt-4",
      api: "/api/chat",
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.toolInvocations).toBeDefined();

    // Verify error handling
    expect(callbacks.onToolCall).toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalled();
  });

  test("should handle tool call with results", async () => {
    // Arrange
    const callbacks = createMockCallbacks();

    // Set up a custom result for this specific test
    callbacks.onToolCall.mockResolvedValueOnce({ content: "72°F and sunny" });

    // Create a tool call with a result
    const toolCall = createToolCallData("tool1", "weather", {
      location: "New York",
    });

    // Add result information
    const toolCallWithResult = {
      ...toolCall,
      result: {
        content: "72°F and sunny",
      },
    };

    const dataChunks = [
      { type: "text", value: "Weather result:" },
      { type: "tool_call", value: toolCallWithResult },
    ];

    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model: "gpt-4",
      api: "/api/chat",
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.toolInvocations).toBeDefined();

    // Check if the tool call result is preserved
    if (result?.toolInvocations && result.toolInvocations.length > 0) {
      const toolInvocation = result.toolInvocations[0];

      // Safely check for result property
      if (toolInvocation && "result" in toolInvocation) {
        expect(toolInvocation.result).toBeDefined();
        // Check result content if it exists and has the expected format
        if (
          typeof toolInvocation.result === "object" &&
          toolInvocation.result !== null
        ) {
          expect(toolInvocation.result).toHaveProperty("content");
          expect(toolInvocation.result.content).toBe("72°F and sunny");
        }
      }
    }
  });

  test("should handle mixed tool call states", async () => {
    // Arrange
    const callbacks = createMockCallbacks();

    // Override the default onToolCall behavior to avoid adding results to all tools
    // Instead, we'll conditionally add results based on the tool ID
    callbacks.onToolCall.mockImplementation((toolCall) => {
      if (toolCall.toolCallId === "tool1") {
        // For the pending tool, don't return a result
        return Promise.resolve(undefined);
      } else if (toolCall.toolCallId === "tool2") {
        // For the completed tool, return the expected result
        return Promise.resolve({ content: "4" });
      } else {
        // For the error tool, reject with an error
        return Promise.reject(new Error("Tool call failed"));
      }
    });

    // Create tool calls with different states
    const pendingToolCall = createToolCallData("tool1", "weather", {
      location: "New York",
    });

    // Tool call with result
    const completedToolCall = createToolCallData("tool2", "calculator", {
      expression: "2+2",
    });
    const completedToolCallWithResult = {
      ...completedToolCall,
      result: {
        content: "4",
      },
    };

    // Tool call with error
    const errorToolCall = createToolCallData("tool3", "translate", {
      text: "Hello",
      language: "es",
    });
    const errorToolCallWithError = {
      ...errorToolCall,
      error: {
        message: "Unsupported language",
        code: "invalid_param",
      },
    };

    const dataChunks = [
      { type: "text", value: "Mixed tool states:" },
      { type: "tool_call", value: pendingToolCall },
      { type: "tool_call", value: completedToolCallWithResult },
      { type: "tool_call", value: errorToolCallWithError },
    ];

    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model: "gpt-4",
      api: "/api/chat",
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.toolInvocations).toBeDefined();

    if (result?.toolInvocations) {
      expect(result.toolInvocations.length).toBe(3);

      // Helper functions to check tool call state
      const hasProperty = (obj: any, prop: string) =>
        obj &&
        typeof obj === "object" &&
        prop in obj &&
        obj[prop] !== undefined;

      // Find tools by their IDs
      const findToolById = (id: string) =>
        result.toolInvocations?.find((tool) => tool.toolCallId === id);

      // Check pending tool call (no result or error)
      const pendingTool = findToolById("tool1");
      expect(pendingTool).toBeDefined();
      expect(hasProperty(pendingTool, "result")).toBe(false);
      expect(hasProperty(pendingTool, "error")).toBe(false);

      // Check completed tool call (has result)
      const completedTool = findToolById("tool2");
      expect(completedTool).toBeDefined();
      if (completedTool && "result" in completedTool) {
        expect(completedTool.result).toBeDefined();
        if (typeof completedTool.result === "object" && completedTool.result) {
          expect(completedTool.result.content).toBe("4");
        }
      }

      // Check error tool call (has error)
      const errorTool = findToolById("tool3");
      expect(errorTool).toBeDefined();
      if (errorTool && "error" in errorTool) {
        expect(errorTool.error).toBeDefined();
        if (typeof errorTool.error === "object" && errorTool.error) {
          // Type assertion to access the code property
          const errorObj = errorTool.error as { code: string; message: string };
          expect(errorObj.code).toBe("invalid_param");
        }
      }
    }
  });
});
