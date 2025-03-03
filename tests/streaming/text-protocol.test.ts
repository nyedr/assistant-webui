import { describe, test, expect, vi } from "vitest";
import { streamChatMessage } from "../../lib/utils/chat";
import {
  mockFetch,
  setupMocks,
  createMockResponse,
  createMockTextStream,
  mockMessages,
  createMockCallbacks,
  wait,
} from "./test-utils";

// Set up mocks for each test
setupMocks();

const model = "meta-llama/llama-3.2-1b-instruct:free";
const api = "/api/chat/proxy";

describe("Text Protocol Streaming", () => {
  test("should accumulate text content correctly", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream([
      "Hello",
      " world",
      "! How",
      " are you",
      " today?",
    ]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).toBe("Hello world! How are you today?");
  });

  test("should call onStreamPart for each chunk", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const chunks = ["Hello", " world", "! How", " are you", " today?"];
    const mockStream = createMockTextStream(chunks);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(callbacks.onStreamPart).toHaveBeenCalledTimes(chunks.length);

    // Check if each chunk was passed to onStreamPart
    chunks.forEach((chunk, index) => {
      expect(callbacks.onStreamPart.mock.calls[index][0]).toBe(chunk);
    });
  });

  test("should create a message with the correct fields", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream(["Hello world!"]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.id).toBeDefined();
    expect(result?.role).toBe("assistant");
    expect(result?.content).toBe("Hello world!");
  });

  test("should include text part in the message parts array", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream(["Hello world!"]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.parts).toBeDefined();
    if (result?.parts) {
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]).toEqual({
        type: "text",
        text: "Hello world!",
      });
    }
  });

  test("should handle empty text stream gracefully", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream([]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).toBe("");
    if (result?.parts) {
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]).toEqual({
        type: "text",
        text: "",
      });
    }
  });

  test("should handle whitespace and newlines correctly", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream([
      "Line 1\n",
      "Line 2\n",
      "  Line with spaces  \n",
      "\tLine with tab",
    ]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).toBe(
      "Line 1\nLine 2\n  Line with spaces  \n\tLine with tab"
    );
  });

  test("should throttle onUpdate calls during text streaming", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream([
      "Part 1",
      " Part 2",
      " Part 3",
      " Part 4",
      " Part 5",
    ]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      abortController: () => new AbortController(),
      api,
      streamProtocol: "text",
      ...callbacks,
    });

    // Wait for throttle to complete
    await wait(100);

    // Assert
    // We expect fewer onUpdate calls than chunks due to throttling
    expect(callbacks.onUpdate.mock.calls.length).toBeLessThan(5);
  });

  test("should update the message progressively during streaming", async () => {
    // Arrange
    const onUpdate = vi.fn();
    const mockStream = createMockTextStream(["Part 1", " Part 2", " Part 3"]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      onUpdate,
      abortController: () => new AbortController(),
    });

    // Wait for all updates
    await wait(100);

    // Assert
    expect(onUpdate).toHaveBeenCalled();

    // The accumulation should progress
    const calls = onUpdate.mock.calls;
    for (let i = 1; i < calls.length; i++) {
      const prevContent = calls[i - 1][0].message.content;
      const currentContent = calls[i][0].message.content;
      expect(currentContent.length).toBeGreaterThanOrEqual(prevContent.length);
    }

    // The final update should have the complete content
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.message.content).toBe("Part 1 Part 2 Part 3");
  });
});
