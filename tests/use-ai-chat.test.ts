/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAIChat } from "../hooks/use-ai-chat";
import type { Message } from "ai";
import type { HookDependencies } from "../lib/hooks/dependencies";

// Create a stub for StreamProtocol
type StreamProtocol = "data" | "text";

describe("useAIChat", () => {
  // Mock dependencies
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockIdGenerator = {
    generate: vi.fn().mockReturnValue("test-uuid-123"),
  };

  const mockChatAPIClient = {
    streamChatMessages: vi.fn().mockResolvedValue("message-id-123"),
  };

  const mockDependencies: HookDependencies = {
    logger: mockLogger,
    idGenerator: mockIdGenerator,
    chatAPIClient: mockChatAPIClient,
  };

  // Mock SWR for the test environment
  vi.mock("swr", () => ({
    default: () => ({
      data: [],
      mutate: vi.fn(),
    }),
  }));

  // Mock window-dependent functions
  vi.mock("usehooks-ts", () => ({
    useLocalStorage: () => [null, vi.fn()],
    useWindowSize: () => ({ width: 1024, height: 768 }),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a chat ID using the injected ID generator", () => {
    const { result } = renderHook(() =>
      useAIChat({
        dependencies: mockDependencies,
      })
    );

    expect(mockIdGenerator.generate).toHaveBeenCalled();
    expect(result.current.id).toBe("test-uuid-123");
  });

  it("should use injected logger when appending messages", async () => {
    const { result } = renderHook(() =>
      useAIChat({
        dependencies: mockDependencies,
      })
    );

    const message: Message = {
      id: "test-message-id",
      role: "user",
      content: "Hello, world!",
    };

    await act(async () => {
      await result.current.append(message);
    });

    expect(mockLogger.debug).toHaveBeenCalled();
    expect(mockLogger.debug.mock.calls[0][0]).toContain(
      "append called with message"
    );
  });

  it("should use injected chat API client for streaming messages", async () => {
    const { result } = renderHook(() =>
      useAIChat({
        dependencies: mockDependencies,
        streamProtocol: "data" as StreamProtocol,
      })
    );

    const message: Message = {
      id: "test-message-id",
      role: "user",
      content: "Hello, world!",
    };

    await act(async () => {
      await result.current.append(message);
    });

    expect(mockChatAPIClient.streamChatMessages).toHaveBeenCalledTimes(1);
  });

  it("should use the provided ID when available", () => {
    const { result } = renderHook(() =>
      useAIChat({
        id: "provided-id",
        dependencies: mockDependencies,
      })
    );

    expect(mockIdGenerator.generate).not.toHaveBeenCalled();
    expect(result.current.id).toBe("provided-id");
  });

  it("should handle submit with injected dependencies", async () => {
    const { result } = renderHook(() =>
      useAIChat({
        dependencies: mockDependencies,
        streamProtocol: "data" as StreamProtocol,
      })
    );

    await act(async () => {
      result.current.setInput("Test input");
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockIdGenerator.generate).toHaveBeenCalledTimes(2); // Once for chat ID, once for message ID
    expect(mockChatAPIClient.streamChatMessages).toHaveBeenCalledTimes(1);
  });
});
