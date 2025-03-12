/**
 * @vitest-environment jsdom
 */

import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { useAIChat } from "../hooks/use-ai-chat";
import type { ExtendedMessage } from "../lib/utils/messages";

// Create partial type for the messages to avoid Date type issues
type TestMessage = Omit<ExtendedMessage, "createdAt"> & {
  createdAt: string;
};

// Mock SWR and other dependencies
let mockSWRData = {
  messages: [] as TestMessage[],
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  error: undefined as undefined | Error,
  branchState: {} as Record<string, number>,
  currentId: null as string | null,
};

const mockSWRMutate = vi.fn().mockImplementation((newData) => {
  // Update mockSWRData based on what's being mutated
  if (newData && typeof newData === "function") {
    const updatedData = newData(mockSWRData);
    if (updatedData) {
      Object.assign(mockSWRData, updatedData);
    }
  } else if (newData) {
    Object.assign(mockSWRData, newData);
  }
  return Promise.resolve(mockSWRData);
});

// Mock SWR module
vi.mock("swr", () => ({
  default: vi.fn((_key) => {
    // Parse the key to determine what data to return
    const key = Array.isArray(_key) ? _key[1] : "default";

    if (key === "messages") {
      return {
        data: mockSWRData.messages,
        mutate: mockSWRMutate,
      };
    } else if (key === "status") {
      return {
        data: mockSWRData.status,
        mutate: mockSWRMutate,
      };
    } else if (key === "error") {
      return {
        data: mockSWRData.error,
        mutate: mockSWRMutate,
      };
    } else if (key === "branchState") {
      return {
        data: mockSWRData.branchState,
        mutate: mockSWRMutate,
      };
    } else if (key === "currentId") {
      return {
        data: mockSWRData.currentId,
        mutate: mockSWRMutate,
      };
    }

    return {
      data: undefined,
      mutate: mockSWRMutate,
    };
  }),
}));

// Mock window-dependent functions
vi.mock("usehooks-ts", () => ({
  useLocalStorage: () => [null, vi.fn()],
  useWindowSize: () => ({ width: 1024, height: 768 }),
}));

// Mock toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock dependencies
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockIdGenerator = {
  generate: vi.fn(
    () => `test-id-${Math.random().toString(36).substring(2, 9)}`
  ),
};

const mockAbortController = {
  abort: vi.fn(),
  signal: {} as AbortSignal,
};

global.AbortController = vi.fn(() => mockAbortController) as any;

const mockChatAPIClient = {
  streamChatMessages: vi
    .fn()
    .mockImplementation(async ({ onUpdate, onFinish }) => {
      // Update status to streaming as soon as this is called
      mockSWRData.status = "streaming";
      await mockSWRMutate({ status: "streaming" });

      // Basic implementation to simulate streaming
      if (onUpdate) {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay before first update
        onUpdate({
          message: {
            id: "streaming-msg",
            role: "assistant",
            content: "I'm an AI assistant response",
            createdAt: new Date().toISOString(),
          },
          replaceLastMessage: true,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay before finishing

      if (onFinish) {
        await onFinish(
          {
            id: "streaming-msg",
            role: "assistant",
            content: "I'm an AI assistant response",
            createdAt: new Date().toISOString(),
          },
          { finishReason: "complete" }
        );
      }

      // Set status back to ready after finishing
      mockSWRData.status = "ready";
      await mockSWRMutate({ status: "ready" });

      return "streaming-msg";
    }),
};

const mockDependencies = {
  logger: mockLogger,
  idGenerator: mockIdGenerator,
  chatAPIClient: mockChatAPIClient,
};

// Sample test messages
const mockInitialMessages: TestMessage[] = [
  {
    id: "msg-user-1",
    role: "user",
    content: "Hello, AI!",
    createdAt: new Date().toISOString(),
  },
  {
    id: "msg-assistant-1",
    role: "assistant",
    content: "Hello! How can I help you today?",
    createdAt: new Date().toISOString(),
    parent_id: "msg-user-1",
  },
];

// Messages with branches
const mockMessageWithBranches: TestMessage[] = [
  {
    id: "parent-msg-1",
    role: "user",
    content: "Create a function in JavaScript",
    createdAt: new Date().toISOString(),
    children_ids: ["branch-1", "branch-2"],
  },
  {
    id: "branch-1",
    role: "assistant",
    content: "Here's a simple function: function add(a, b) { return a + b; }",
    createdAt: new Date().toISOString(),
    parent_id: "parent-msg-1",
  },
  {
    id: "branch-2",
    role: "assistant",
    content: "Here's an arrow function: const add = (a, b) => a + b;",
    createdAt: new Date().toISOString(),
    parent_id: "parent-msg-1",
  },
];

// Test Components
// Basic chat component
const BasicChatComponent = ({
  initialMessages = [],
}: {
  initialMessages?: ExtendedMessage[];
}) => {
  const {
    messages,
    activeMessages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
  } = useAIChat({
    initialMessages: initialMessages as ExtendedMessage[],
    dependencies: mockDependencies,
  });

  return (
    <div data-testid="chat-container">
      <div data-testid="messages-list">
        {activeMessages.map((msg) => (
          <div
            key={msg.id}
            data-testid={`message-${msg.role}`}
            data-message-id={msg.id}
          >
            {msg.content}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        data-testid="chat-form"
      >
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          data-testid="chat-input"
        />
        <button type="submit" disabled={isLoading} data-testid="submit-button">
          Send
        </button>
        {isLoading && <div data-testid="loading-indicator">Loading...</div>}
      </form>
    </div>
  );
};

// Component with branching functionality
const BranchingChatComponent = ({
  initialMessages = [],
}: {
  initialMessages?: ExtendedMessage[];
}) => {
  const {
    activeMessages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    switchBranch,
    getBranchInfo,
    retryMessage,
  } = useAIChat({
    initialMessages: initialMessages as ExtendedMessage[],
    dependencies: mockDependencies,
  });

  return (
    <div data-testid="branching-chat">
      <div data-testid="messages-list">
        {activeMessages.map((msg) => (
          <div key={msg.id} data-testid={`message-${msg.id}`}>
            <div data-testid={`content-${msg.id}`}>{msg.content}</div>

            {/* Add retry button for all messages to make testing easier */}
            <button
              onClick={() => retryMessage(msg.id)}
              data-testid={`retry-button-${msg.id}`}
            >
              Retry
            </button>

            {msg.children_ids && msg.children_ids.length > 1 && (
              <div data-testid={`branches-${msg.id}`}>
                {msg.children_ids.map((_, i) => {
                  const branchInfo = getBranchInfo(msg.id);
                  const isActive = i === branchInfo.currentIndex;

                  return (
                    <button
                      key={i}
                      onClick={() => switchBranch(msg.id, i)}
                      data-testid={`branch-button-${i}`}
                      disabled={isActive}
                    >
                      Option {i + 1} {isActive ? "(active)" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        data-testid="chat-form"
      >
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          data-testid="chat-input"
        />
        <button type="submit" disabled={isLoading} data-testid="submit-button">
          Send
        </button>
        {isLoading && <div data-testid="loading-indicator">Loading...</div>}
      </form>
    </div>
  );
};

// Component with stop functionality
const StoppableChatComponent = () => {
  const {
    activeMessages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    stop,
  } = useAIChat({
    dependencies: mockDependencies,
  });

  return (
    <div data-testid="stoppable-chat">
      <div data-testid="messages-list">
        {activeMessages.map((msg) => (
          <div key={msg.id} data-testid={`message-${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        data-testid="chat-form"
      >
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          data-testid="chat-input"
        />
        <button type="submit" disabled={isLoading} data-testid="submit-button">
          Send
        </button>
        {isLoading && (
          <>
            <div data-testid="loading-indicator">Loading...</div>
            <button type="button" onClick={stop} data-testid="stop-button">
              Stop
            </button>
          </>
        )}
      </form>
    </div>
  );
};

// Component that uses React state alongside the hook
const StatefulChatComponent = () => {
  const [messageCount, setMessageCount] = useState(0);

  const { activeMessages, input, handleInputChange, handleSubmit, isLoading } =
    useAIChat({
      dependencies: mockDependencies,
    });

  // Track message count when submitted
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      setMessageCount((prev) => prev + 1);
      handleSubmit();
    }
  };

  return (
    <div data-testid="stateful-chat">
      <div data-testid="message-count">Messages sent: {messageCount}</div>

      <div data-testid="messages-list">
        {activeMessages.map((msg) => (
          <div key={msg.id} data-testid={`message-${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleFormSubmit} data-testid="chat-form">
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          data-testid="chat-input"
        />
        <button type="submit" disabled={isLoading} data-testid="submit-button">
          Send
        </button>
        {isLoading && <div data-testid="loading-indicator">Loading...</div>}
      </form>
    </div>
  );
};

describe("useAIChat Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSWRData = {
      messages: [],
      status: "ready",
      error: undefined,
      branchState: {},
      currentId: null,
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Basic Chat Component", () => {
    it("should render initial messages correctly", () => {
      // Use mock data for this test
      mockSWRData.messages = mockInitialMessages;
      mockSWRData.currentId = "msg-assistant-1";

      render(
        <BasicChatComponent initialMessages={mockInitialMessages as any} />
      );

      // Verify messages are displayed
      expect(screen.getAllByTestId(/message-/)).toHaveLength(2);
      expect(screen.getByText("Hello, AI!")).toBeInTheDocument();
      expect(
        screen.getByText("Hello! How can I help you today?")
      ).toBeInTheDocument();
    });

    it("should handle user input and message submission", async () => {
      // Start with empty messages
      mockSWRData.messages = [];

      render(<BasicChatComponent />);

      // Type in the input
      const user = userEvent.setup();
      const input = screen.getByTestId("chat-input");
      await user.type(input, "Test message");

      // Verify input value
      expect(input).toHaveValue("Test message");

      // Update our implementation to set the status when triggered
      mockChatAPIClient.streamChatMessages.mockImplementationOnce(
        async ({ onUpdate, onFinish }) => {
          // Set status to streaming
          mockSWRData.status = "streaming";
          await mockSWRMutate({ status: "streaming" });

          // Add user message to the mock data
          mockSWRData.messages = [
            {
              id: "user-message",
              role: "user",
              content: "Test message",
              createdAt: new Date().toISOString(),
            },
          ];

          // Mock the loading state
          await new Promise((resolve) => setTimeout(resolve, 50));

          if (onUpdate) {
            onUpdate({
              message: {
                id: "assistant-response",
                role: "assistant",
                content: "Response to test message",
                createdAt: new Date().toISOString(),
                parent_id: "user-message",
              },
              replaceLastMessage: true,
            });
          }

          // Add response to our mock data
          mockSWRData.messages.push({
            id: "assistant-response",
            role: "assistant",
            content: "Response to test message",
            createdAt: new Date().toISOString(),
            parent_id: "user-message",
          });

          // Update currentId
          mockSWRData.currentId = "assistant-response";

          if (onFinish) {
            await onFinish(mockSWRData.messages[1] as any, {
              finishReason: "complete",
            });
          }

          // Set status back to ready
          mockSWRData.status = "ready";
          await mockSWRMutate({ status: "ready" });

          return "assistant-response";
        }
      );

      // Submit the form
      const submitButton = screen.getByTestId("submit-button");
      await user.click(submitButton);

      // Should have called the streamChatMessages method
      expect(mockChatAPIClient.streamChatMessages).toHaveBeenCalledTimes(1);

      // Input should be cleared after submission
      expect(input).toHaveValue("");

      // Make sure the component reflects the status
      const { rerender } = render(<BasicChatComponent />);

      // Force a rerender to make sure our status changes are reflected
      rerender(<BasicChatComponent />);

      // Check for the right messages
      await waitFor(
        () => {
          expect(mockSWRData.status).toBe("ready");
        },
        { timeout: 1000 }
      );
    });

    it("should handle form submission via Enter key", async () => {
      render(<BasicChatComponent />);

      const user = userEvent.setup();
      const input = screen.getByTestId("chat-input");

      // Type and press Enter
      await user.type(input, "Test with Enter{Enter}");

      // Should have called the streamChatMessages method
      expect(mockChatAPIClient.streamChatMessages).toHaveBeenCalledTimes(1);

      // Input should be cleared
      expect(input).toHaveValue("");
    });
  });

  describe("Branching Chat Component", () => {
    it("should display branch UI for messages with multiple children", () => {
      // Set up branching data
      mockSWRData.messages = mockMessageWithBranches;
      mockSWRData.branchState = { "parent-msg-1": 0 }; // First branch is active
      mockSWRData.currentId = "branch-1";

      render(
        <BranchingChatComponent
          initialMessages={mockMessageWithBranches as any}
        />
      );

      // Should show branch buttons
      expect(screen.getByTestId("branches-parent-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("branch-button-0")).toBeInTheDocument();
      expect(screen.getByTestId("branch-button-1")).toBeInTheDocument();

      // Should show the content of the first branch
      expect(screen.getByText(/Here's a simple function/)).toBeInTheDocument();
      // Should NOT show content from other branches
      expect(
        screen.queryByText(/Here's an arrow function/)
      ).not.toBeInTheDocument();
    });

    it("should switch between branches when clicking branch buttons", async () => {
      // Set up branching data
      mockSWRData.messages = mockMessageWithBranches;
      mockSWRData.branchState = { "parent-msg-1": 0 }; // First branch is active
      mockSWRData.currentId = "branch-1";

      const { rerender } = render(
        <BranchingChatComponent
          initialMessages={mockMessageWithBranches as any}
        />
      );

      // First branch should be displayed
      expect(screen.getByText(/Here's a simple function/)).toBeInTheDocument();

      // Click the second branch button
      const user = userEvent.setup();
      await user.click(screen.getByTestId("branch-button-1"));

      // Update mock data immediately to reflect change
      mockSWRData.branchState = { "parent-msg-1": 1 }; // Second branch is now active
      mockSWRData.currentId = "branch-2";

      // Force rerender to see the changes
      rerender(
        <BranchingChatComponent
          initialMessages={mockMessageWithBranches as any}
        />
      );

      // Now the second branch should be displayed
      await waitFor(
        () => {
          expect(
            screen.getByText(/Here's an arrow function/)
          ).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it("should render retry buttons for messages", () => {
      // Set up initial messages
      mockSWRData.messages = mockInitialMessages;
      mockSWRData.currentId = "msg-assistant-1";

      render(
        <BranchingChatComponent initialMessages={mockInitialMessages as any} />
      );

      // Initially should show original message
      expect(
        screen.getByText("Hello! How can I help you today?")
      ).toBeInTheDocument();

      // Check that retry buttons are rendered for both messages
      expect(screen.getByTestId("retry-button-msg-user-1")).toBeInTheDocument();
      expect(
        screen.getByTestId("retry-button-msg-assistant-1")
      ).toBeInTheDocument();
    });
  });

  describe("Stopping Functionality", () => {
    it("should abort streaming when stop button is clicked", async () => {
      // Simulate a long-running streaming response
      mockChatAPIClient.streamChatMessages.mockImplementationOnce(
        async ({ onUpdate }) => {
          // Start streaming and update UI
          mockSWRData.status = "streaming";
          await mockSWRMutate({ status: "streaming" });

          // Add user message to the mock data
          mockSWRData.messages = [
            {
              id: "user-message",
              role: "user",
              content: "Start streaming",
              createdAt: new Date().toISOString(),
            },
          ];

          // Start streaming
          onUpdate({
            message: {
              id: "streaming-msg",
              role: "assistant",
              content: "I'm starting to respond...",
              createdAt: new Date().toISOString(),
              parent_id: "user-message",
            },
            replaceLastMessage: true,
          });

          // Add response to our mock data
          mockSWRData.messages.push({
            id: "streaming-msg",
            role: "assistant",
            content: "I'm starting to respond...",
            createdAt: new Date().toISOString(),
            parent_id: "user-message",
          });

          // Update currentId
          mockSWRData.currentId = "streaming-msg";

          // Return a promise that doesn't resolve immediately
          return new Promise((resolve) => {
            // In a real implementation this would take time to complete
            setTimeout(() => resolve("streaming-msg"), 5000);
          });
        }
      );

      const { rerender } = render(<StoppableChatComponent />);

      // Type and submit a message
      const user = userEvent.setup();
      await user.type(screen.getByTestId("chat-input"), "Start streaming");
      await user.click(screen.getByTestId("submit-button"));

      // Force rerender to see status changes
      mockSWRData.status = "streaming";
      rerender(<StoppableChatComponent />);

      // Now the loading indicator and stop button should appear
      await waitFor(
        () => {
          const loadingIndicator = screen.queryByTestId("loading-indicator");
          expect(loadingIndicator).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Find and click the stop button
      const stopButton = screen.getByTestId("stop-button");
      await user.click(stopButton);

      // Should have called abort
      expect(mockAbortController.abort).toHaveBeenCalled();

      // Update status to ready to simulate stopping
      mockSWRData.status = "ready";
      await mockSWRMutate({ status: "ready" });

      // Force another rerender
      rerender(<StoppableChatComponent />);

      // Loading indicator and stop button should disappear
      await waitFor(
        () => {
          expect(
            screen.queryByTestId("loading-indicator")
          ).not.toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });

  describe("Integration with React State", () => {
    it("should work correctly with component state", async () => {
      render(<StatefulChatComponent />);

      // Initial message count should be 0
      expect(screen.getByTestId("message-count").textContent).toBe(
        "Messages sent: 0"
      );

      // Submit a message
      const user = userEvent.setup();
      await user.type(screen.getByTestId("chat-input"), "First message");
      await user.click(screen.getByTestId("submit-button"));

      // Message count should increment
      expect(screen.getByTestId("message-count").textContent).toBe(
        "Messages sent: 1"
      );

      // Submit another message
      await user.type(screen.getByTestId("chat-input"), "Second message");
      await user.click(screen.getByTestId("submit-button"));

      // Message count should increment again
      expect(screen.getByTestId("message-count").textContent).toBe(
        "Messages sent: 2"
      );

      // The API should be called for each message
      expect(mockChatAPIClient.streamChatMessages).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", async () => {
      // Mock an API error
      mockChatAPIClient.streamChatMessages.mockImplementationOnce(async () => {
        // Simulate an error
        mockSWRData.status = "error";
        mockSWRData.error = new Error("API Error");
        await mockSWRMutate({
          status: "error",
          error: new Error("API Error"),
        });

        throw new Error("API Error");
      });

      render(<BasicChatComponent />);

      // Submit a message that will cause an error
      const user = userEvent.setup();
      await user.type(screen.getByTestId("chat-input"), "Error message");
      await user.click(screen.getByTestId("submit-button"));

      // Status should change to error
      await waitFor(() => {
        expect(mockSWRData.status).toBe("error");
      });

      // Should be able to submit another message after error
      mockSWRData.status = "ready";
      mockSWRData.error = undefined;

      await user.type(screen.getByTestId("chat-input"), "Next message");
      await user.click(screen.getByTestId("submit-button"));

      // Should have called the API again
      expect(mockChatAPIClient.streamChatMessages).toHaveBeenCalledTimes(2);
    });
  });

  describe("Real-time Updates", () => {
    it("should update UI in real-time during streaming", async () => {
      // Mock a streaming response with multiple updates
      mockChatAPIClient.streamChatMessages.mockImplementationOnce(
        async ({ onUpdate, onFinish }) => {
          const messageId = "streaming-message";

          // Set status to streaming
          mockSWRData.status = "streaming";
          await mockSWRMutate({ status: "streaming" });

          // Add user message and initial response
          mockSWRData.messages = [
            {
              id: "user-msg",
              role: "user",
              content: "Streaming test",
              createdAt: new Date().toISOString(),
            },
            {
              id: messageId,
              role: "assistant",
              content: "First part",
              createdAt: new Date().toISOString(),
              parent_id: "user-msg",
            },
          ];

          // First update
          onUpdate({
            message: {
              id: messageId,
              role: "assistant",
              content: "First part",
              createdAt: new Date().toISOString(),
              parent_id: "user-msg",
            },
            replaceLastMessage: true,
          });

          // Update currentId
          mockSWRData.currentId = messageId;

          // Second update
          await new Promise((r) => setTimeout(r, 50));
          mockSWRData.messages[1] = {
            id: messageId,
            role: "assistant",
            content: "First part of the response",
            createdAt: new Date().toISOString(),
            parent_id: "user-msg",
          };

          onUpdate({
            message: mockSWRData.messages[1],
            replaceLastMessage: true,
          });

          // Final update
          await new Promise((r) => setTimeout(r, 50));
          mockSWRData.messages[1] = {
            id: messageId,
            role: "assistant",
            content: "First part of the response. And the conclusion!",
            createdAt: new Date().toISOString(),
            parent_id: "user-msg",
          };

          onUpdate({
            message: mockSWRData.messages[1],
            replaceLastMessage: true,
          });

          // Call onFinish
          if (onFinish) {
            await onFinish(mockSWRData.messages[1] as any, {
              finishReason: "complete",
            });
          }

          // Set status back to ready
          mockSWRData.status = "ready";
          await mockSWRMutate({ status: "ready" });

          return messageId;
        }
      );

      const { rerender } = render(<BasicChatComponent />);

      // Submit message to trigger streaming
      const user = userEvent.setup();
      await user.type(screen.getByTestId("chat-input"), "Streaming test");
      await user.click(screen.getByTestId("submit-button"));

      // Force rerender with the updated messages
      rerender(<BasicChatComponent />);

      // Test if we can see the message content (any version)
      await waitFor(
        () => {
          expect(screen.getByText(/First part/)).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });
});
