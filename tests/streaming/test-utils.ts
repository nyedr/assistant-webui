import { vi, Mock, beforeEach, afterEach, expect } from "vitest";
import { Message } from "ai";

// Mock global fetch
export const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Reset mocks before each test
export function setupMocks() {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

// Helper to create a mock readable stream from text chunks
export function createMockTextStream(chunks: string[]): ReadableStream {
  let chunkIndex = 0;

  return new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        const chunk = chunks[chunkIndex];
        controller.enqueue(new TextEncoder().encode(chunk));
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });
}

// Helper to create a mock readable stream from data chunks
export function createMockDataStream(chunks: any[]): ReadableStream {
  let chunkIndex = 0;

  // Track whether we've already added a newline for a reasoning chunk
  const reasoningTracker: Record<string, boolean> = {};

  return new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        const chunk = chunks[chunkIndex];

        // Map the data protocol format (e.g., { type: "text", text: "Hello" })
        // to the format expected by processStreamPart (e.g., { type: "text", value: "Hello" })
        let adaptedChunk = { ...chunk };

        // For data protocol tests, map fields to match what processStreamPart expects
        if (chunk.type === "text" && "text" in chunk) {
          adaptedChunk = { type: "text", value: chunk.text };
        } else if (chunk.type === "reasoning" && "reasoning" in chunk) {
          // Add a newline between multiple reasoning chunks
          const reasoningValue = chunk.reasoning;
          if (
            reasoningTracker["reasoning"] &&
            !reasoningValue.startsWith("\n")
          ) {
            adaptedChunk = { type: "reasoning", value: "\n" + reasoningValue };
          } else {
            adaptedChunk = { type: "reasoning", value: reasoningValue };
          }
          reasoningTracker["reasoning"] = true;
        } else if (
          chunk.type === "reasoning_signature" &&
          "reasoning_signature" in chunk
        ) {
          adaptedChunk = {
            type: "reasoning_signature",
            value: { signature: chunk.reasoning_signature },
          };
        } else if (chunk.type === "source" && "source" in chunk) {
          adaptedChunk = { type: "source", value: chunk.source };
        } else if (chunk.type === "annotations" && "annotations" in chunk) {
          adaptedChunk = {
            type: "message_annotation",
            value: chunk.annotations,
          };
        } else if (chunk.type === "data" && "data" in chunk) {
          adaptedChunk = { type: "data", value: chunk.data };
        }

        // Format as SSE data with proper prefix and double newlines
        const formattedChunk =
          typeof chunk === "string"
            ? chunk
            : `data: ${JSON.stringify(adaptedChunk)}\n\n`;

        const encoded = new TextEncoder().encode(formattedChunk);
        controller.enqueue(encoded);
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });
}

// Helper to create a mock readable stream that throws an error
export function createMockErrorStream(error: Error): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.error(error);
    },
  });
}

// Helper to create a mock response
export function createMockResponse(
  body: ReadableStream | null = null,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  return {
    body,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers),
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(""),
    clone: () => createMockResponse(body, status, headers),
  } as Response;
}

// Helper to create a network error
export function createNetworkError(): Error {
  const error = new Error("Network error");
  error.name = "NetworkError";
  return error;
}

// Mock messages for testing
export const mockMessages: Message[] = [
  {
    id: "msg1",
    role: "system",
    content: "You are a helpful assistant.",
  },
  {
    id: "msg2",
    role: "user",
    content: "Hello, can you help me?",
  },
];

// Helper function to wait for a specified time
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to mock custom abort controller for testing signal
export function createMockAbortController() {
  const abortFn = vi.fn();

  return {
    signal: {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    abort: abortFn,
  };
}

// Helper to assert a callback was called with certain arguments
export function assertCallbackCalled(
  mock: Mock,
  callIndex: number = 0,
  expectedArgs?: any[]
) {
  expect(mock).toHaveBeenCalled();

  if (expectedArgs) {
    expect(mock.mock.calls[callIndex]).toEqual(expectedArgs);
  }
}

// Helper to assert a callback was not called
export function assertCallbackNotCalled(mock: Mock) {
  expect(mock).not.toHaveBeenCalled();
}

// Helper to create tool call data
export function createToolCallData(
  id: string = "tool1",
  name: string = "test_tool",
  arguments_: Record<string, any> = { param: "value" },
  type: string = "function"
) {
  return {
    id,
    toolCallId: id,
    toolName: name,
    type,
    function: {
      name,
      arguments: JSON.stringify(arguments_),
    },
    args: arguments_,
  };
}

// Helper to create error data
export function createErrorData(
  message: string = "Error occurred",
  code: string = "error_code"
) {
  return {
    type: "error",
    error: {
      message,
      code,
    },
  };
}

// Mock common callback functions
export function createMockCallbacks() {
  return {
    onResponse: vi.fn(),
    onUpdate: vi.fn(),
    onStreamPart: vi.fn((chunk, data, protocol) => {
      // If this is a data protocol call, we need to extract the text content for text parts
      if (
        protocol === "data" &&
        data &&
        typeof data === "object" &&
        "type" in data
      ) {
        if (data.type === "text" && "value" in data) {
          return data.value;
        }
      }
      return chunk;
    }),
    onFinish: vi.fn(),
    onToolCall: vi.fn().mockImplementation(({ toolCallId, toolName }) => {
      // Always return a Promise with a properly structured result
      // This ensures consistent behavior with what the application expects
      return Promise.resolve({
        content: `mock result for ${toolName} (${toolCallId})`,
      });
    }),
    onError: vi.fn(),
    restoreMessagesOnFailure: vi.fn(),
  };
}
