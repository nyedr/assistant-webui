import { describe, test, expect, vi } from "vitest";
import { streamChatMessage } from "../../lib/utils/chat";
import {
  mockFetch,
  setupMocks,
  createMockResponse,
  createMockDataStream,
  mockMessages,
  createMockCallbacks,
  wait,
} from "./test-utils";

// Set up mocks for each test
setupMocks();

const model = "meta-llama/llama-3.2-1b-instruct:free";
const api = "/api/chat/proxy";

describe("Data Protocol Streaming", () => {
  test("should process text data type correctly", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const dataChunks = [
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
      { type: "text", text: "!" },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).toBe("Hello world!");
    if (result?.parts) {
      expect(result.parts).toContainEqual({
        type: "text",
        text: "Hello world!",
      });
    }
  });

  test("should process reasoning data type correctly", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const dataChunks = [
      { type: "text", text: "Response" },
      { type: "reasoning", reasoning: "This is my reasoning" },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).toBe("Response");
    expect(result?.data?.reasoning).toBe("This is my reasoning");
    if (result?.parts) {
      expect(result.parts).toContainEqual({
        type: "reasoning",
        reasoning: "This is my reasoning",
        details: [
          {
            type: "text",
            text: "This is my reasoning",
          },
        ],
      });
    }
  });

  test("should handle reasoning_signature data type", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const dataChunks = [
      { type: "text", text: "Response" },
      { type: "reasoning_signature", reasoning_signature: "sig123" },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.data?.reasoning_signature).toBe("sig123");
  });

  test("should handle source data type", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const sourceData = {
      type: "document",
      title: "Test Document",
      url: "https://example.com/doc",
      chunk: "This is a chunk of text",
    };
    const dataChunks = [
      { type: "text", text: "Response with source" },
      { type: "source", source: sourceData },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.data?.source).toEqual(sourceData);
    if (result?.parts) {
      expect(result.parts).toContainEqual({
        type: "source",
        source: sourceData,
      });
    }
  });

  test("should handle annotations data type", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const annotations = [
      {
        type: "citation",
        text: "reference",
        startIndex: 10,
        endIndex: 19,
        citation: {
          type: "document",
          title: "Title",
          url: "https://example.com",
        },
      },
    ];
    const dataChunks = [
      { type: "text", text: "Text with reference citation" },
      { type: "annotations", annotations },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.data?.annotations).toEqual(annotations);
  });

  test("should handle multiple data chunks with mixed types", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const dataChunks = [
      { type: "text", text: "Hello" },
      { type: "reasoning", reasoning: "Thinking about greeting" },
      { type: "text", text: " world!" },
      { type: "reasoning", reasoning: "Added exclamation for emphasis" },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).toBe("Hello world!");
    expect(result?.data?.reasoning).toBe(
      "Thinking about greeting\nAdded exclamation for emphasis"
    );
    if (result?.parts) {
      expect(result.parts).toHaveLength(2); // Text, reasoning
      expect(result.parts.filter((p) => p.type === "text")).toHaveLength(1);
      expect(result.parts.filter((p) => p.type === "reasoning")).toHaveLength(
        1
      );
    }
  });

  test("should call onStreamPart for each data chunk", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const dataChunks = [
      { type: "text", text: "Hello" },
      { type: "reasoning", reasoning: "Thinking" },
      { type: "text", text: " world!" },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(callbacks.onStreamPart).toHaveBeenCalledTimes(dataChunks.length);

    // Text chunks should be passed with their content
    expect(callbacks.onStreamPart).toHaveBeenCalledWith(
      "Hello",
      expect.objectContaining({ type: "text" }),
      "data"
    );
    expect(callbacks.onStreamPart).toHaveBeenCalledWith(
      " world!",
      expect.objectContaining({ type: "text" }),
      "data"
    );

    // Non-text chunks should be passed with empty string as first param
    expect(callbacks.onStreamPart).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ type: "reasoning" }),
      "data"
    );
  });

  test("should accumulate text content across multiple chunks", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const dataChunks = [
      { type: "text", text: "Part 1" },
      { type: "text", text: " Part 2" },
      { type: "text", text: " Part 3" },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).toBe("Part 1 Part 2 Part 3");
  });

  test("should update progressively during data streaming", async () => {
    // Arrange
    const onUpdate = vi.fn();
    const dataChunks = [
      { type: "text", text: "Part 1" },
      { type: "text", text: " Part 2" },
      { type: "reasoning", reasoning: "Some reasoning" },
      { type: "text", text: " Part 3" },
    ];
    const mockStream = createMockDataStream(dataChunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "data",
      onUpdate,
      abortController: () => new AbortController(),
    });

    // Wait for all updates
    await wait(100);

    // Assert
    expect(onUpdate).toHaveBeenCalled();

    // Content should accumulate
    const calls = onUpdate.mock.calls;
    let prevContent = "";
    for (const call of calls) {
      const currentContent = call[0].message.content;
      expect(currentContent.length).toBeGreaterThanOrEqual(prevContent.length);
      prevContent = currentContent;
    }

    // The final update should have the complete content
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.message.content).toBe("Part 1 Part 2 Part 3");
  });
});
