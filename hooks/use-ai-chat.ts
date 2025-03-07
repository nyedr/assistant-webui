"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Message, Attachment } from "ai";
// Import generic types instead of specific ones that don't exist
import type {
  RequestOptions as AIRequestOptions,
  JSONValue,
  ToolCall,
} from "ai";
import useSWR from "swr";
import {
  ExtendedMessage as ChatExtendedMessage,
  StreamProtocol,
} from "@/lib/utils/chat";
import {
  ExtendedChatRequestOptions,
  updateMessageRelationships,
  ensureExtendedMessage,
  prepareMessageWithRelationships,
  findLastUserMessageId,
  ExtendedMessage,
} from "@/lib/utils/messages";
import { generateUUID } from "@/lib/utils";
import logger from "@/lib/utils/logger";
import { callChatApi, UIMessage } from "@ai-sdk/ui-utils";

// Define our own ChatRequestOptions that includes what we need
export type ChatRequestOptions = AIRequestOptions & {
  headers?: Record<string, string>;
  body?: Record<string, any>;
  experimental_attachments?: Attachment[];
};

// Extend our ChatRequestOptions to match what we need
export interface ExtendedRequestOptions extends ExtendedChatRequestOptions {
  headers?: Record<string, string>;
  body?: Record<string, any>;
  experimental_attachments?: Attachment[];
}

export interface UseAIChatOptions {
  /**
   * ID of the chat. If not provided, a random ID will be generated.
   */
  id?: string;

  /**
   * The model to use for the chat completion.
   */
  model?: string;

  /**
   * Initial messages for the chat.
   */
  initialMessages?: Message[];

  /**
   * Initial input value for the chat.
   */
  initialInput?: string;

  /**
   * API endpoint for chat completion. Defaults to "/api/chat/proxy".
   */
  api?: string;

  /**
   * HTTP headers to send with the request.
   */
  headers?: Record<string, string>;

  /**
   * Additional body parameters to send with the request.
   */
  body?: Record<string, any>;

  /**
   * Stream protocol to use for the chat completion. Defaults to "data".
   */
  streamProtocol?: StreamProtocol;

  /**
   * Whether to include extra message fields in the API request.
   */
  sendExtraMessageFields?: boolean;

  /**
   * Whether to keep the last message on error. Defaults to true.
   */
  keepLastMessageOnError?: boolean;

  /**
   * Experimental: Throttle the UI updates. Specify the wait time in ms.
   */
  experimental_throttle?: number;

  /**
   * Callback when a response is received.
   */
  onResponse?: (response: Response) => void | Promise<void>;

  /**
   * Callback when the stream is finished.
   */
  onFinish?: (
    message: ChatExtendedMessage,
    finishReason?: Record<string, any>
  ) => void;

  /**
   * Callback when an error occurs.
   */
  onError?: (error: Error) => void;

  /**
   * Callback when a stream part is received.
   */
  onStreamPart?: (part: string, delta: any, type: string) => void;

  /**
   * Callback when a tool call is received. Should return a promise that resolves with the tool result.
   */
  onToolCall?: (toolCall: {
    toolCallId: string;
    toolName: string;
    args: any;
  }) => Promise<any>;
}

interface BranchState {
  [messageId: string]: number; // parentMessageId -> currentBranchIndex
}

export interface UseAIChatHelpers {
  /** Current messages in the chat */
  messages: ExtendedMessage[];
  /** The error object of the API request */
  error: undefined | Error;
  /**
   * Append a user message to the chat list. This triggers the API call to fetch
   * the assistant's response.
   */
  append: (
    message: Message | Partial<ExtendedMessage>,
    options?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  /**
   * Reload the last AI chat response for the given chat history. If the last
   * message isn't from the assistant, it will request the API to generate a
   * new response.
   */
  reload: (
    chatRequestOptions?: ExtendedRequestOptions
  ) => Promise<string | null | undefined>;
  /**
   * Abort the current request immediately, keep the generated tokens if any.
   */
  stop: () => void;
  /**
   * Update the `messages` state locally.
   */
  setMessages: (
    messages:
      | ExtendedMessage[]
      | ((messages: ExtendedMessage[]) => ExtendedMessage[])
  ) => void;
  /** The current value of the input */
  input: string;
  /** setState-powered method to update the input value */
  setInput: React.Dispatch<React.SetStateAction<string>>;
  /** An input/textarea-ready onChange handler to control the value of the input */
  handleInputChange: (
    e:
      | React.ChangeEvent<HTMLInputElement>
      | React.ChangeEvent<HTMLTextAreaElement>
  ) => void;
  /** Form submission handler to automatically reset input and append a user message */
  handleSubmit: (
    event?: { preventDefault?: () => void },
    chatRequestOptions?: ExtendedRequestOptions
  ) => void;
  /**
   * Whether the API request is in progress
   */
  isLoading: boolean;
  /**
   * Hook status:
   *
   * - `submitted`: The message has been sent to the API and we're awaiting the start of the response stream.
   * - `streaming`: The response is actively streaming in from the API, receiving chunks of data.
   * - `ready`: The full response has been received and processed; a new user message can be submitted.
   * - `error`: An error occurred during the API request, preventing successful completion.
   */
  status: "submitted" | "streaming" | "ready" | "error";
  /**
   * Switch to a different branch (alternative response) for a parent message
   */
  switchBranch: (parentMessageId: string, branchIndex: number) => void;
  /**
   * Get information about branches for a parent message
   */
  getBranchInfo: (parentMessageId: string) => {
    currentIndex: number;
    totalBranches: number;
  };
  /**
   * Retry a specific assistant message to get an alternative response
   */
  retryMessage: (messageId: string) => Promise<string | null | undefined>;
  /** The id of the chat */
  id: string;
}

// Define an adapter function that converts between our custom types and the types expected by callChatApi
async function adaptCallChatApi({
  messages,
  id,
  model,
  api,
  streamProtocol,
  headers,
  body,
  attachments,
  abortController,
  onResponse,
  onUpdate: handleUpdate,
  onStreamPart,
  onFinish,
  onToolCall,
  onError,
  restoreMessagesOnFailure,
  replaceLastMessage,
  lastMessage,
}: {
  messages: Message[];
  id: string;
  model: string;
  api: string;
  streamProtocol: StreamProtocol;
  headers?: Record<string, string>;
  body?: Record<string, any>;
  attachments?: Attachment[];
  abortController: (() => AbortController | null) | undefined;
  onResponse?: (response: Response) => void | Promise<void>;
  onUpdate: ({
    message,
    replaceLastMessage,
  }: {
    message: ChatExtendedMessage;
    replaceLastMessage: boolean;
  }) => void;
  onStreamPart?: (part: string, delta: any, type: string) => void;
  onFinish: (
    message: ChatExtendedMessage,
    finishReason?: Record<string, any>
  ) => void;
  onToolCall?: (toolCall: {
    toolCallId: string;
    toolName: string;
    args: any;
  }) => Promise<any>;
  onError?: (error: Error) => void;
  restoreMessagesOnFailure?: () => void;
  replaceLastMessage: boolean;
  lastMessage: ChatExtendedMessage;
}) {
  // Adapt the lastMessage to UIMessage format
  const adaptedLastMessage: UIMessage = {
    id: lastMessage.id,
    role: lastMessage.role,
    content: lastMessage.content,
    createdAt: lastMessage.createdAt,
    // Ensure parts is not undefined
    parts: lastMessage.parts || [],
  };

  // Adapt onUpdate to match expected signature
  const adaptedOnUpdate = (options: {
    message: UIMessage;
    data: JSONValue[] | undefined;
    replaceLastMessage: boolean;
  }) => {
    // Convert UIMessage back to ChatExtendedMessage
    const chatExtMsg: ChatExtendedMessage = {
      ...options.message,
      parent_id: (options.message as any).parent_id,
      children_ids: (options.message as any).children_ids || [],
      model: (options.message as any).model,
      // Preserve parts
      parts: options.message.parts,
      // Make sure data is Record<string, any> | undefined
      data: options.message.data as Record<string, any> | undefined,
    };

    // Call original onUpdate
    handleUpdate({
      message: chatExtMsg,
      replaceLastMessage: options.replaceLastMessage,
    });
  };

  // Adapt onToolCall to match expected signature
  const adaptedOnToolCall = onToolCall
    ? ({ toolCall }: { toolCall: ToolCall<string, unknown> }) => {
        return onToolCall({
          toolCallId: toolCall.toolCallId || "",
          toolName: toolCall.toolName,
          args: toolCall.args,
        });
      }
    : undefined;

  // Ensure restoreMessagesOnFailure is never undefined
  const adaptedRestoreMessagesOnFailure =
    restoreMessagesOnFailure || (() => {});

  // Call the original function with adapted parameters
  await callChatApi({
    api,
    body: {
      id,
      ...body,
      messages,
      ...(attachments ? { experimental_attachments: attachments } : {}),
    },
    streamProtocol,
    credentials: undefined,
    headers,
    abortController,
    restoreMessagesOnFailure: adaptedRestoreMessagesOnFailure,
    onResponse,
    onUpdate: adaptedOnUpdate,
    onFinish: (message, details) => {
      // Convert UIMessage to ChatExtendedMessage
      const adaptedMessage: ChatExtendedMessage = {
        ...message,
        parent_id: (message as any).parent_id,
        children_ids: (message as any).children_ids || [],
        model: (message as any).model || model || "unknown",
        parts: message.parts || [],
        data: message.data as Record<string, any> | undefined,
      };

      onFinish(adaptedMessage, details);
    },
    onToolCall: adaptedOnToolCall,
    // IdGenerator is needed, but we'll use a simple implementation
    generateId: () => crypto.randomUUID(),
    fetch: fetch,
    lastMessage: adaptedLastMessage,
  });

  // No need to return anything, we're not using the result
  return null;
}

/**
 * Hook for AI chat with improved parent-child message tracking, branch handling, and retry behavior
 */
export function useAIChat({
  id,
  api = "/api/chat/proxy",
  initialMessages = [],
  initialInput = "",
  model,
  headers,
  body = {},
  streamProtocol = "data",
  sendExtraMessageFields = true,
  keepLastMessageOnError = true,
  experimental_throttle,
  onResponse,
  onFinish,
  onError,
  onStreamPart,
  onToolCall,
}: UseAIChatOptions = {}): UseAIChatHelpers {
  // Generate a stable ID for this chat if not provided
  const chatIdRef = useRef<string>(id || generateUUID());
  const chatId = chatIdRef.current;

  // Create a SWR cache key for this chat
  const chatKey = `chat:${chatId}`;

  // Store messages with proper parent-child relationships
  const { data: messages = [], mutate: mutateMessages } = useSWR<
    ExtendedMessage[]
  >([chatKey, "messages"], null, {
    fallbackData: initialMessages.map((msg) => ensureExtendedMessage(msg)),
  });

  // Store the current status of the chat
  const { data: status = "ready", mutate: mutateStatus } = useSWR<
    "submitted" | "streaming" | "ready" | "error"
  >([chatKey, "status"], null);

  // Store any error that occurs
  const { data: error = undefined, mutate: setError } = useSWR<
    undefined | Error
  >([chatKey, "error"], null);

  // Store which branch index is currently visible for each parent message
  const { data: branchState = {}, mutate: mutateBranchState } =
    useSWR<BranchState>([chatKey, "branchState"], null, {
      fallbackData: {},
    });

  // Store the input value
  const [input, setInput] = useState(initialInput);

  // Keep references to current state to avoid closure issues
  const messagesRef = useRef<ExtendedMessage[]>(messages);
  const branchStateRef = useRef<BranchState>(branchState);

  // Update refs when state changes
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    branchStateRef.current = branchState;
  }, [branchState]);

  // Abort controller for canceling requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Meta information including model, headers, etc.
  const metaRef = useRef({
    model,
    headers,
    body,
  });

  // Update metaRef when props change
  useEffect(() => {
    metaRef.current = {
      model,
      headers,
      body,
    };
  }, [model, headers, body]);

  // Throttle function for UI updates if experimental_throttle is enabled
  const throttle = useCallback(
    <T extends any[]>(fn: (...args: T) => void, wait?: number) => {
      if (!wait) return fn;

      let lastCalled = 0;
      let timeout: NodeJS.Timeout | null = null;
      let lastArgs: T | null = null;

      return (...args: T) => {
        const now = Date.now();
        const timeSinceLastCall = now - lastCalled;

        lastArgs = args;

        if (timeSinceLastCall >= wait) {
          if (timeout) {
            clearTimeout(timeout);
            timeout = null;
          }
          lastCalled = now;
          fn(...args);
        } else if (!timeout) {
          timeout = setTimeout(() => {
            lastCalled = Date.now();
            timeout = null;
            if (lastArgs) fn(...lastArgs);
          }, wait - timeSinceLastCall);
        }
      };
    },
    []
  );

  // Create throttled versions of mutate functions
  const throttledMutateMessages = useCallback(
    (
      newMessagesOrFn:
        | ExtendedMessage[]
        | ((messages: ExtendedMessage[]) => ExtendedMessage[]),
      shouldRevalidate = false
    ) => {
      const fn = throttle(mutateMessages, experimental_throttle);
      fn(newMessagesOrFn as any, shouldRevalidate);
    },
    [mutateMessages, experimental_throttle, throttle]
  );

  /**
   * Handle incoming message updates during streaming
   */
  const handleUpdate = useCallback(
    ({
      message,
      replaceLastMessage,
    }: {
      message: ChatExtendedMessage;
      replaceLastMessage: boolean;
    }) => {
      mutateStatus("streaming");

      // Convert ChatExtendedMessage to our local ExtendedMessage type if needed
      const compatibleMessage: ExtendedMessage = {
        ...message,
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        parent_id: message.parent_id,
        children_ids: message.children_ids || [],
        model: message.model || model || "unknown",
        parts: message.parts || [],
      };

      // Process parent-child relationships for incoming message
      throttledMutateMessages((currentMessages) => {
        // If we should replace the last message (e.g., during streaming)
        if (replaceLastMessage) {
          const lastMessageIndex = currentMessages.length - 1;

          // If there are no messages or the last one isn't from the assistant, just append
          if (
            lastMessageIndex < 0 ||
            currentMessages[lastMessageIndex].role !== "assistant"
          ) {
            // This is a new message, so establish parent-child relationships
            return updateMessageRelationships(
              currentMessages,
              compatibleMessage
            );
          } else {
            // Replace the last message but keep its relationship properties
            const updatedMessages = [...currentMessages];
            const existingMessage = updatedMessages[lastMessageIndex];

            updatedMessages[lastMessageIndex] = {
              ...compatibleMessage,
              // Preserve relationship data
              parent_id: existingMessage.parent_id,
              children_ids: existingMessage.children_ids || [],
            };

            return updatedMessages;
          }
        } else {
          // This is a new message, establish parent-child relationships
          return updateMessageRelationships(currentMessages, compatibleMessage);
        }
      }, false);
    },
    [throttledMutateMessages, mutateStatus]
  );

  /**
   * Trigger a request to the AI API
   */
  const triggerRequest = useCallback(
    async (chatRequest: {
      messages: Message[];
      headers?: Record<string, string>;
      body?: Record<string, any>;
      options?: ExtendedRequestOptions;
      attachments?: Attachment[];
    }) => {
      mutateStatus("submitted");
      setError(undefined);

      // Get the current state
      const currentMessages = messagesRef.current;

      try {
        // Create a new abort controller for this request
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Extract options and prepare messages
        const {
          messages,
          headers: reqHeaders,
          body: reqBody,
          options,
          attachments,
        } = chatRequest;

        // Ensure parent-child relationships are established
        const processedMessages = messages.map((msg) => {
          // If the message already has parent_id set, use it as is
          if ((msg as ExtendedMessage).parent_id) {
            return ensureExtendedMessage(msg);
          }

          // Otherwise, establish appropriate relationships
          return prepareMessageWithRelationships(
            msg,
            currentMessages,
            metaRef.current.model || ""
          );
        });

        // Keep track of the original state for error recovery
        const previousMessages = [...currentMessages];

        // Update the UI optimistically
        throttledMutateMessages(processedMessages, false);

        // Format messages for the API based on sendExtraMessageFields setting
        const apiMessages = sendExtraMessageFields
          ? processedMessages.map((msg) => ({
              id: msg.id || generateUUID(),
              role: msg.role,
              content: msg.content,
              createdAt: msg.createdAt,
              ...(msg.experimental_attachments !== undefined && {
                experimental_attachments: msg.experimental_attachments,
              }),
            }))
          : processedMessages.map(
              ({ id, role, content, createdAt, experimental_attachments }) => ({
                id: id || generateUUID(),
                role,
                content,
                createdAt,
                ...(experimental_attachments !== undefined && {
                  experimental_attachments,
                }),
              })
            );

        // Find the last message for context during streaming
        const lastMessage = processedMessages[
          processedMessages.length - 1
        ] as ChatExtendedMessage;

        // Stream the message to the API
        await adaptCallChatApi({
          messages: apiMessages as Message[],
          id: chatId,
          model: metaRef.current.model || model || "unknown",
          api,
          streamProtocol,
          headers: {
            ...metaRef.current.headers,
            ...reqHeaders,
          },
          body: {
            ...metaRef.current.body,
            ...reqBody,
            ...(options?.options || {}),
          },
          attachments,
          abortController: () => abortControllerRef.current!,
          onResponse,
          onUpdate: handleUpdate,
          onStreamPart,
          onFinish: (message, finishReason) => {
            // Set status to ready
            mutateStatus("ready");

            // Log finish information with detailed context
            logger.debug("Chat message stream finished", {
              module: "useAIChat",
              context: {
                messageId: message.id,
                finishReason,
                modelUsed: message.model,
              },
            });

            // Clear abort controller
            abortControllerRef.current = null;

            // Convert ChatExtendedMessage to our local ExtendedMessage type
            const compatibleMessage: ExtendedMessage = {
              ...message,
              id: message.id,
              role: message.role,
              content: message.content,
              createdAt: message.createdAt,
              parent_id: message.parent_id,
              children_ids: message.children_ids || [],
              model: message.model || model || "unknown",
              parts: message.parts || [],
            };

            // Ensure message relationships are properly established
            throttledMutateMessages((currentMsgs) => {
              return updateMessageRelationships(currentMsgs, compatibleMessage);
            }, false);

            // Call user-provided onFinish callback if available
            if (onFinish) {
              try {
                onFinish(message, finishReason);
              } catch (error) {
                logger.error(
                  "Error in user-provided onFinish callback",
                  error instanceof Error ? error : new Error(String(error)),
                  { module: "useAIChat" }
                );
              }
            }
          },
          onToolCall,
          onError,
          restoreMessagesOnFailure: !keepLastMessageOnError
            ? () => throttledMutateMessages(previousMessages, false)
            : undefined,
          replaceLastMessage: true, // Replace during streaming for UI updates
          lastMessage,
        });
      } catch (err) {
        // Ignore abort errors as they are expected
        if ((err as any).name === "AbortError") {
          abortControllerRef.current = null;
          mutateStatus("ready");
          return null;
        }

        // Handle other errors
        if (onError && err instanceof Error) {
          onError(err);
        }

        setError(err as Error);
        mutateStatus("error");
        return null;
      }
    },
    [
      api,
      chatId,
      handleUpdate,
      keepLastMessageOnError,
      mutateStatus,
      onError,
      onFinish,
      onResponse,
      onStreamPart,
      onToolCall,
      setError,
      streamProtocol,
      sendExtraMessageFields,
      throttledMutateMessages,
    ]
  );

  /**
   * Append a new message to the chat
   */
  const append = useCallback(
    async (
      message: Message | Partial<ExtendedMessage>,
      options: ChatRequestOptions = {}
    ) => {
      const currentMessages = messagesRef.current;

      // Create a new message with an ID if it doesn't have one
      const newMessage: ExtendedMessage = {
        id: message.id || generateUUID(), // Always ensure there's an ID
        role: message.role || "user", // Default to user if not specified
        content: message.content || "",
        createdAt: message.createdAt || new Date(),
        parts: [],
        children_ids: [],
        ...(message as Partial<ExtendedMessage>), // Include any additional fields
      };

      // Find appropriate parent for this message
      if (!newMessage.parent_id) {
        if (newMessage.role === "assistant") {
          // For assistant messages, parent should be the last user message
          newMessage.parent_id = findLastUserMessageId(currentMessages);
        } else if (newMessage.role === "user" && currentMessages.length > 0) {
          // For user messages, parent should be the last assistant message if any
          for (let i = currentMessages.length - 1; i >= 0; i--) {
            if (currentMessages[i].role === "assistant") {
              newMessage.parent_id = currentMessages[i].id;
              break;
            }
          }
        }
      }

      // Create updated message array
      const updatedMessages = updateMessageRelationships(
        currentMessages,
        newMessage
      );

      // Send the request - for user messages, this will generate an assistant response
      if (newMessage.role === "user") {
        // For user messages, trigger a request to get assistant response
        return triggerRequest({
          messages: updatedMessages,
          headers: options.headers,
          body: options.body,
          options: options as ExtendedRequestOptions,
          attachments: options.experimental_attachments,
        });
      } else {
        // For non-user messages, just update the UI
        throttledMutateMessages(updatedMessages, false);
        return newMessage.id;
      }
    },
    [throttledMutateMessages, triggerRequest]
  );

  /**
   * Reload the chat to generate a new response
   */
  const reload = useCallback(
    async (chatRequestOptions: ExtendedRequestOptions = {}) => {
      const currentMessages = messagesRef.current;

      if (currentMessages.length === 0) {
        return null;
      }

      // Get the last message in the chat
      const lastMessage = currentMessages[currentMessages.length - 1];

      // If the options include a parentMessageId, we're doing a branch/retry
      if (chatRequestOptions.options?.parentMessageId) {
        const parentMessageId = chatRequestOptions.options.parentMessageId;
        const parentIndex = currentMessages.findIndex(
          (msg) => msg.id === parentMessageId
        );

        if (parentIndex >= 0) {
          // If we found the parent, keep messages up to and including the parent
          const messagesToKeep = currentMessages.slice(0, parentIndex + 1);

          // Check for a preserved message ID - used for retries to preserve message history
          const preserveMessageId =
            chatRequestOptions.options.preserveMessageId;

          // If we're preserving message branch history, we need to ensure the UI state
          // maintains the relationship data
          if (preserveMessageId) {
            // Ensure parent has the child in its children_ids
            const parentMessage = messagesToKeep.find(
              (msg) => msg.id === parentMessageId
            ) as ExtendedMessage;
            if (
              parentMessage &&
              !parentMessage.children_ids?.includes(preserveMessageId)
            ) {
              throttledMutateMessages((prevMessages) => {
                return prevMessages.map((msg) => {
                  if (msg.id === parentMessageId) {
                    const extMsg = ensureExtendedMessage(msg);
                    // Add the preserved message ID to children_ids if it doesn't exist
                    const children = extMsg.children_ids || [];
                    if (!children.includes(preserveMessageId)) {
                      children.push(preserveMessageId);
                    }
                    return {
                      ...extMsg,
                      children_ids: children,
                    };
                  }
                  return msg;
                });
              }, false);
            }
          }

          // Trigger a new request with the preserved messages
          return triggerRequest({
            messages: messagesToKeep,
            headers: chatRequestOptions.headers,
            body: chatRequestOptions.body,
            options: chatRequestOptions,
          });
        }
      }

      // Standard reload (remove last assistant message and try again)
      const messagesToSend =
        lastMessage.role === "assistant"
          ? currentMessages.slice(0, -1)
          : currentMessages;

      return triggerRequest({
        messages: messagesToSend,
        headers: chatRequestOptions.headers,
        body: chatRequestOptions.body,
        options: chatRequestOptions,
      });
    },
    [triggerRequest, throttledMutateMessages]
  );

  /**
   * Stop the current request
   */
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      mutateStatus("ready");
    }
  }, [mutateStatus]);

  /**
   * Update the messages state locally
   */
  const setMessages = useCallback(
    (
      newMessages:
        | ExtendedMessage[]
        | ((messages: ExtendedMessage[]) => ExtendedMessage[])
    ) => {
      if (typeof newMessages === "function") {
        throttledMutateMessages((currentMessages) => {
          const resultMessages = newMessages(currentMessages);
          return resultMessages.map((msg) => ensureExtendedMessage(msg));
        }, false);
      } else {
        throttledMutateMessages(
          newMessages.map((msg) => ensureExtendedMessage(msg)),
          false
        );
      }
    },
    [throttledMutateMessages]
  );

  /**
   * Handle input changes
   */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    []
  );

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(
    async (
      event?: { preventDefault?: () => void },
      chatRequestOptions: ExtendedRequestOptions = {}
    ) => {
      event?.preventDefault?.();

      if (!input.trim()) return;

      // Create a new user message
      const userMessage: ExtendedMessage = {
        id: generateUUID(), // Always generate a new ID for user messages
        role: "user",
        content: input,
        createdAt: new Date(),
        children_ids: [],
        parts: [],
      };

      // NOTE: Input clearing is now handled by the UI components for immediate feedback
      // No need to clear input here

      // Append the message and get the assistant response
      return append(userMessage, {
        ...chatRequestOptions,
        // Only include these fields if actually provided in chatRequestOptions
        ...(chatRequestOptions.headers && {
          headers: chatRequestOptions.headers,
        }),
        ...(chatRequestOptions.body && { body: chatRequestOptions.body }),
        ...(chatRequestOptions.experimental_attachments && {
          experimental_attachments: chatRequestOptions.experimental_attachments,
        }),
      });
    },
    [append, input]
  );

  /**
   * Switch to a different branch (alternative response) for a parent message
   */
  const switchBranch = useCallback(
    (parentMessageId: string, branchIndex: number) => {
      const currentMessages = messagesRef.current;
      const parentIndex = currentMessages.findIndex(
        (msg) => msg.id === parentMessageId
      );

      if (parentIndex < 0) return;

      const parent = currentMessages[parentIndex] as ExtendedMessage;
      const childrenIds = parent.children_ids || [];

      // Check if branch index is valid
      if (branchIndex < 0 || branchIndex >= childrenIds.length) return;

      // Update branch state to track which branch is currently visible
      mutateBranchState(
        (prev) => ({
          ...prev,
          [parentMessageId]: branchIndex,
        }),
        false
      );

      // Find current visible assistant message responding to this parent
      const currentAssistantIndex = currentMessages.findIndex(
        (msg, i) =>
          i > parentIndex &&
          msg.role === "assistant" &&
          msg.parent_id === parentMessageId
      );

      // Find the target branch message
      const targetBranchId = childrenIds[branchIndex];
      const allMessages = [...currentMessages]; // Clone to include all messages

      // Find the target branch message in the full message set
      const targetBranch = allMessages.find((msg) => msg.id === targetBranchId);

      if (!targetBranch) return;

      // Create new messages array
      throttledMutateMessages((current) => {
        const newMessages = [...current];

        if (currentAssistantIndex >= 0) {
          // Replace the current assistant message with the target branch
          newMessages[currentAssistantIndex] = targetBranch;

          // If there are messages after the assistant message, remove them
          // as we're now on a different branch
          if (currentAssistantIndex < newMessages.length - 1) {
            return newMessages.slice(0, currentAssistantIndex + 1);
          }
        } else {
          // If no assistant message is currently visible, insert after parent
          newMessages.splice(parentIndex + 1, 0, targetBranch);
        }

        return newMessages;
      }, false);
    },
    [mutateBranchState, throttledMutateMessages]
  );

  /**
   * Get information about branches for a parent message
   */
  const getBranchInfo = useCallback((parentMessageId: string) => {
    const currentMessages = messagesRef.current;
    const branchStates = branchStateRef.current;

    // Find the parent message
    const parent = currentMessages.find((msg) => msg.id === parentMessageId) as
      | ExtendedMessage
      | undefined;

    if (!parent || !parent.children_ids) {
      return { currentIndex: 0, totalBranches: 0 };
    }

    const totalBranches = parent.children_ids.length;
    const currentIndex = branchStates[parentMessageId] || 0;

    return { currentIndex, totalBranches };
  }, []);

  /**
   * Retry a specific assistant message to get an alternative response
   */
  const retryMessage = useCallback(
    async (messageId: string) => {
      const currentMessages = messagesRef.current;

      // Find the message to retry
      const messageToRetry = currentMessages.find(
        (msg) => msg.id === messageId
      ) as ExtendedMessage | undefined;

      if (!messageToRetry || messageToRetry.role !== "assistant") {
        return null;
      }

      // Get the parent message ID
      const parentMessageId = messageToRetry.parent_id;

      if (!parentMessageId) {
        return null;
      }

      // Store the current message content and data before retrying
      // We'll need this to ensure content preservation
      const messageContent = messageToRetry.content;
      const messageParts = messageToRetry.parts || [];
      const messageData = messageToRetry.data || {};
      const messageModel = messageToRetry.model || model || "unknown";

      // Ensure we preserve the existing assistant messages associated with this parent
      // Instead of removing them from the UI while generating a new one

      // 1. Find all messages up to and including the parent message
      const parentIndex = currentMessages.findIndex(
        (msg) => msg.id === parentMessageId
      );
      if (parentIndex < 0) return null;

      // 2. Create a backup of all existing child messages for this parent
      // We'll ensure all these messages still have their content preserved
      const childMessages = currentMessages.filter(
        (msg) => msg.parent_id === parentMessageId
      );

      // 3. Before making the network request, update the UI state to ensure
      // message content is preserved for all existing assistant responses
      throttledMutateMessages((prevMessages) => {
        // Create a map of original message content keyed by message ID
        const contentMap = new Map<string, any>();

        // Store content for all messages that we want to preserve
        childMessages.forEach((msg) => {
          contentMap.set(msg.id, {
            content: msg.content,
            parts: msg.parts || [],
            data: msg.data || {},
            model: msg.model || model || "unknown",
          });
        });

        // Update the messages, preserving content for existing messages
        return prevMessages.map((msg) => {
          // If this is a message we should preserve content for
          if (contentMap.has(msg.id)) {
            const savedContent = contentMap.get(msg.id);
            return {
              ...msg,
              content: savedContent.content || msg.content,
              parts: savedContent.parts || msg.parts || [],
              data: savedContent.data || msg.data || {},
              model: savedContent.model || msg.model || model || "unknown",
            };
          }
          return msg;
        });
      }, false);

      // Generate a random seed to prevent cached responses from the model
      const randomSeed = Math.floor(Math.random() * 1000000).toString();

      // Call reload with the parent message ID to generate a new branch
      const result = await reload({
        options: {
          parentMessageId,
          preserveMessageId: messageToRetry.id, // Indicate we're preserving this message
        },
        headers: {
          // Add a custom header for the random seed
          "x-random-seed": randomSeed,
        },
        body: {
          // Also add the seed to the body for providers that might check there
          seed: randomSeed,
        },
      });

      // After the reload completes, make sure the original message content is still preserved
      // This fixes cases where the server might have returned empty content
      setTimeout(() => {
        throttledMutateMessages((prevMessages) => {
          return prevMessages.map((msg) => {
            if (msg.id === messageId) {
              return {
                ...msg,
                content: messageContent || msg.content,
                parts: messageParts.length ? messageParts : msg.parts || [],
                data: Object.keys(messageData).length
                  ? messageData
                  : msg.data || {},
                model: messageModel || msg.model || model || "unknown",
              };
            }
            return msg;
          });
        }, false);
      }, 500); // Small delay to ensure this runs after the reload response is processed

      return result;
    },
    [reload, throttledMutateMessages]
  );

  return {
    messages,
    error,
    append,
    reload,
    stop,
    setMessages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading: status === "submitted" || status === "streaming",
    status,
    switchBranch,
    getBranchInfo,
    retryMessage,
    id: chatId,
  };
}
