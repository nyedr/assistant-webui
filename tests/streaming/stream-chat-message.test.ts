import { describe, test, expect, vi } from "vitest";
import { streamChatMessage } from "../../lib/utils/chat";
import {
  mockFetch,
  setupMocks,
  createMockResponse,
  createMockTextStream,
  createNetworkError,
  mockMessages,
  createMockCallbacks,
  assertCallbackCalled,
  assertCallbackNotCalled,
  createMockDataStream,
} from "./test-utils";

// Set up mocks for each test
setupMocks();

const model = "meta-llama/llama-3.2-1b-instruct:free";
const api = "/api/chat/proxy";

describe("streamChatMessage", () => {
  test("should make a request to the specified API with correct parameters", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream(["Hello", " world"]);
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
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(api, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: mockMessages.map(({ id, role, content }) => ({
          id,
          role,
          content,
        })),
        model,
        id: "chat1",
        stream: true,
        streamProtocol: "text",
      }),
      signal: expect.any(Object),
    });
  });

  test("should include additional body parameters", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream(["Hello"]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));
    const additionalParams = {
      temperature: 0.7,
      max_tokens: 2000,
    };

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      body: additionalParams,
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      api,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining("temperature"),
        signal: expect.any(Object),
      })
    );

    // Parse the body to verify its contents
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual(
      expect.objectContaining({
        messages: expect.any(Array),
        model,
        id: "chat1",
        stream: true,
        streamProtocol: "text",
        temperature: 0.7,
        max_tokens: 2000,
      })
    );
  });

  test("should include custom headers in the request", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream(["Hello"]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));
    const customHeaders = {
      "X-API-Key": "test-key",
      "User-Agent": "test-agent",
    };

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      headers: customHeaders,
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "test-key",
          "User-Agent": "test-agent",
        },
      })
    );
  });

  test("should include attachments in the request", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream(["Response with attachment"]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    const attachments = [
      {
        type: "image",
        url: "https://example.com/image.jpg",
        mimeType: "image/jpeg",
      },
    ];

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      attachments,
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      api,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining("attachments"),
        signal: expect.any(Object),
      })
    );

    // Parse the body to verify its contents
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual(
      expect.objectContaining({
        messages: expect.any(Array),
        model,
        id: "chat1",
        stream: true,
        streamProtocol: "text",
        attachments,
      })
    );
  });

  test("should handle HTTP errors and call onError", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    mockFetch.mockResolvedValueOnce(createMockResponse(null, 500));

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
    assertCallbackCalled(callbacks.onError, 0, [
      expect.objectContaining({
        message: expect.stringContaining("HTTP error 500"),
      }),
    ]);
    assertCallbackCalled(callbacks.restoreMessagesOnFailure);
    assertCallbackNotCalled(callbacks.onFinish);
  });

  test("should handle network errors and call onError", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const networkError = createNetworkError();
    mockFetch.mockRejectedValueOnce(networkError);

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
    assertCallbackCalled(callbacks.onError, 0, [networkError]);
    assertCallbackCalled(callbacks.restoreMessagesOnFailure);
    assertCallbackNotCalled(callbacks.onFinish);
  });

  test("should handle missing response body", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    mockFetch.mockResolvedValueOnce(createMockResponse(null));

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
    assertCallbackCalled(callbacks.onError, 0, [
      expect.objectContaining({
        message: expect.stringContaining("No response body"),
      }),
    ]);
    assertCallbackCalled(callbacks.restoreMessagesOnFailure);
  });

  test("should call onResponse with the response object", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream(["Hello"]);
    const mockResponse = createMockResponse(mockStream);
    mockFetch.mockResolvedValueOnce(mockResponse);

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
    assertCallbackCalled(callbacks.onResponse, 0, [mockResponse]);
  });

  test("should support custom abort controller", async () => {
    // Arrange
    const callbacks = createMockCallbacks();
    const mockStream = createMockTextStream(["Hello"]);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    const abortController = new AbortController();

    // Act
    await streamChatMessage({
      messages: mockMessages,
      id: "chat1",
      model,
      api,
      streamProtocol: "text",
      abortController: () => abortController,
      ...callbacks,
    });

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(Object),
      })
    );
  });
});

describe("Integration Tests", () => {
  test("should correctly process data stream protocol from streamText", async () => {
    // Arrange
    const callbacks = createMockCallbacks();

    // Create a simulated data stream that mimics what streamText would output
    // This is the format that the proxy would return using streamText().toDataStreamResponse()
    const mockDataEvents = [
      // Initial message start
      'data: {"type":"start_step","value":{"messageId":"msg_123"}}\n\n',
      // Text delta - first chunk
      'data: {"type":"text","value":"Hello"}\n\n',
      // Text delta - second chunk
      'data: {"type":"text","value":" world"}\n\n',
      // Reasoning (if enabled)
      'data: {"type":"reasoning","value":"This is a test response"}\n\n',
      // Tool call example (if using tools)
      'data: {"type":"tool_call","value":{"toolCallId":"tool123","toolName":"calculator","args":{"expression":"1+1"}}}\n\n',
      // Tool result
      'data: {"type":"tool_result","value":{"toolCallId":"tool123","result":{"answer":2}}}\n\n',
      // Step finish
      'data: {"type":"finish_step","value":{"finishReason":"stop"}}\n\n',
      // Message finish
      'data: {"type":"finish_message","value":{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":20}}}\n\n',
    ];

    // Create a readable stream from these events
    const mockStream = createMockDataStream(mockDataEvents);
    mockFetch.mockResolvedValueOnce(createMockResponse(mockStream));

    // Act
    const result = await streamChatMessage({
      messages: mockMessages,
      id: "compatibility-test",
      model,
      api,
      streamProtocol: "data", // Important: use data protocol
      abortController: () => new AbortController(),
      ...callbacks,
    });

    // Assert
    expect(result).not.toBeNull();
    if (result) {
      // Verify the basic message structure
      expect(result.role).toBe("assistant");
      expect(result.content).toBe("Hello world");

      // Verify reasoning was captured
      expect(result.reasoning).toBe("This is a test response");

      // Verify tool calls were processed
      expect(result.toolInvocations).toHaveLength(1);
      expect(result.toolInvocations?.[0].toolName).toBe("calculator");
      expect(result.toolInvocations?.[0].args).toEqual({ expression: "1+1" });

      // Verify tool results
      if (
        result.toolInvocations &&
        result.toolInvocations[0].state === "result"
      ) {
        expect(result.toolInvocations[0].result).toEqual({ answer: 2 });
      }
    }

    // Verify that callbacks were called with the expected data
    assertCallbackCalled(callbacks.onFinish);
    assertCallbackNotCalled(callbacks.onError);

    // Check stream part handling
    expect(callbacks.onStreamPart).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: "text" }),
      "data"
    );

    // Verify message update handling
    expect(callbacks.onUpdate).toHaveBeenCalled();
  });
});
