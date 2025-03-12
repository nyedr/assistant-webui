"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Message, Attachment } from "ai";
import useSWR from "swr";
import { StreamProtocol } from "@/lib/types/chat";
import {
  ExtendedChatRequestOptions,
  ensureExtendedMessage,
  ExtendedMessage,
} from "@/lib/utils/messages";
import { handleError } from "@/lib/utils/error-handling";
import {
  ensureParentRelationship,
  establishMessageRelationships,
  establishRelationshipsForNewMessage,
} from "@/lib/messages/relationships";
import {
  sanitizeMessage,
  sanitizeUIMessages,
} from "@/lib/messages/sanitization";
import { findLastUserMessageId } from "@/lib/messages/queries";
import {
  getBranchInfo as getBranchInfoFromState,
  getActivePathWithBranchState,
  prepareRetryState,
  preserveMessageContent,
  type BranchState,
  drillDownToLeafWithBranchState,
} from "@/lib/messages/branching";
import {
  ChatMiddleware,
  MiddlewareConfig,
  executeBeforeRequestMiddleware,
  executeAfterRequestMiddleware,
  executeOnRequestErrorMiddleware,
  getCombinedMiddlewares,
} from "@/lib/chat/middleware";
import {
  HookDependencies,
  defaultDependencies,
} from "@/lib/hooks/dependencies";
import { continuePrompt } from "@/lib/ai/prompts";
import { combineContent } from "@/lib/utils/chat";
import { toast } from "sonner";

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
   * Middleware configuration for extending functionality.
   */
  middleware?: MiddlewareConfig;

  /**
   * Dependency injection for testing.
   * Allows overriding external dependencies like logger, ID generation, etc.
   */
  dependencies?: Partial<HookDependencies>;

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
    message: ExtendedMessage,
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

  /**
   * Callback when a user message has been fully processed with relationships.
   * This is called after the message has been processed but before the AI request is made.
   * Useful for saving messages to the database with proper parent-child relationships.
   */
  onUserMessageProcessed?: (
    message: ExtendedMessage,
    messages: ExtendedMessage[]
  ) => Promise<void> | void;
}

export interface UseAIChatHelpers {
  /** Current messages in the chat */
  messages: ExtendedMessage[];
  /** Filtered messages showing only the active branch path based on branch state */
  activeMessages: ExtendedMessage[];
  /** The error object of the API request */
  error: undefined | Error;
  /**
   * Append a user message to the chat list. This triggers the API call to fetch
   * the assistant's response.
   */
  append: (
    message: ExtendedMessage,
    options?: ExtendedRequestOptions
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
   * Continue the specified assistant message from where it left off.
   * The continued content will be streamed to the same message.
   */
  continue: (messageId: string) => Promise<string | null | undefined>;
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
   * Switch to a different branch (alternative response) for a parent message.
   * This updates the branch state and sets the current message ID to the
   * appropriate leaf node in the selected branch.
   *
   * @param parentMessageId - ID of the parent message whose branch should be switched
   * @param branchIndex - Index of the branch to switch to (0-based)
   */
  switchBranch: (parentMessageId: string, branchIndex: number) => void;
  /**
   * Get information about branches for a parent message.
   *
   * @param parentMessageId - ID of the parent message to get branch info for
   * @returns Object containing currentIndex (selected branch) and totalBranches
   */
  getBranchInfo: (parentMessageId: string) => {
    currentIndex: number;
    totalBranches: number;
  };
  /**
   * Retry a specific assistant message to get an alternative response.
   * This creates a new branch from the parent message.
   *
   * @param messageId - ID of the assistant message to retry
   * @returns ID of the new message if successful, null otherwise
   */
  retryMessage: (messageId: string) => Promise<string | null>;
  /** The id of the chat */
  id: string;
  /** The current active message ID (tip of the active branch) */
  currentId: string | null;
}

/**
 * useAIChat - A React hook for AI chat interactions with branch management
 *
 * This hook provides:
 * 1. Message state management with proper parent-child relationships
 * 2. Branch management for alternate AI responses
 * 3. Active message path calculation based on selected branches
 * 4. API for switching between branches
 *
 * The hook maintains internal state about which branch is selected for each
 * parent message and computes the active message path accordingly.
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
  middleware,
  dependencies,
  experimental_throttle,
  onResponse,
  onFinish,
  onError,
  onStreamPart,
  onToolCall,
  onUserMessageProcessed,
}: UseAIChatOptions = {}): UseAIChatHelpers {
  // Merge provided dependencies with defaults
  const deps = useMemo(
    () => ({ ...defaultDependencies, ...dependencies }),
    [dependencies]
  );

  // Generate a stable ID for this chat if not provided
  const chatIdRef = useRef<string>(id || deps.idGenerator.generate());
  const chatId = chatIdRef.current;

  // Process middleware configuration
  const middlewaresRef = useRef<ChatMiddleware[]>(
    getCombinedMiddlewares(middleware)
  );

  // Update middlewares when the config changes
  useEffect(() => {
    middlewaresRef.current = getCombinedMiddlewares(middleware);
  }, [middleware]);

  // Process initial messages to ensure proper parent-child relationships
  const processedInitialMessages = useMemo(() => {
    // Process the initial messages to ensure proper parent-child relationships
    return establishMessageRelationships(
      // Sanitize messages before establishing relationships
      sanitizeUIMessages(
        initialMessages.map((msg) => ensureExtendedMessage(msg))
      )
    );
  }, [initialMessages]);

  // Store messages with proper parent-child relationships
  const { data: messages = [], mutate: mutateMessages } = useSWR<
    ExtendedMessage[]
  >([chatId, "messages"], null, {
    fallbackData: processedInitialMessages,
  });

  // Store the current status of the chat
  const { data: status = "ready", mutate: mutateStatus } = useSWR<
    "submitted" | "streaming" | "ready" | "error"
  >([chatId, "status"], null);

  // Store any error that occurs
  const { data: error = undefined, mutate: setError } = useSWR<
    undefined | Error
  >([chatId, "error"], null);

  // Create a custom fetcher for branch state
  const branchStateFetcher = useCallback(() => {
    // Try to get the value from localStorage
    const storedValue =
      typeof window !== "undefined"
        ? localStorage.getItem(`chat-branch-state-${chatId}`)
        : null;

    if (storedValue) {
      try {
        return JSON.parse(storedValue);
      } catch (e) {
        console.error("[useAIChat] Error parsing stored branch state:", e);
      }
    }
    return {};
  }, [chatId]);

  // Store which branch index is currently visible for each parent message
  const { data: branchState = {}, mutate: mutateBranchStateInternal } =
    useSWR<BranchState>([chatId, "branchState"], branchStateFetcher, {
      fallbackData: {},
    });

  // Custom function to update branchState and persist it
  const mutateBranchState = useCallback(
    (updaterOrValue: BranchState | ((prev: BranchState) => BranchState)) => {
      // Update SWR cache
      mutateBranchStateInternal((prevState) => {
        // Ensure prevState is never undefined
        const currentState = prevState || {};

        const newState =
          typeof updaterOrValue === "function"
            ? updaterOrValue(currentState)
            : updaterOrValue;

        // Persist to localStorage if available
        if (typeof window !== "undefined") {
          localStorage.setItem(
            `chat-branch-state-${chatId}`,
            JSON.stringify(newState)
          );
        }

        console.log("[useAIChat] Updated branch state:", newState);
        return newState;
      }, false);
    },
    [mutateBranchStateInternal, chatId]
  );

  // Create a custom fetcher and initial data loader for currentId
  const currentIdFetcher = useCallback(() => {
    // Try to get the value from localStorage
    const storedValue =
      typeof window !== "undefined"
        ? localStorage.getItem(`chat-current-id-${chatId}`)
        : null;
    return storedValue || null;
  }, [chatId]);

  // Store the current active message ID (tip of the active branch)
  const { data: currentId = null, mutate: mutateCurrentId } = useSWR<
    string | null
  >([chatId, "currentId"], currentIdFetcher);

  // Custom function to update currentId and persist it
  const setCurrentId = useCallback(
    (newId: string | null) => {
      // Update SWR cache
      mutateCurrentId(newId, false);

      // Persist to localStorage if available
      if (typeof window !== "undefined" && newId) {
        localStorage.setItem(`chat-current-id-${chatId}`, newId);
      } else if (typeof window !== "undefined") {
        localStorage.removeItem(`chat-current-id-${chatId}`);
      }

      console.log("[useAIChat] Setting currentId to:", newId);
    },
    [mutateCurrentId, chatId]
  );

  // Store the input value
  const [input, setInput] = useState(initialInput);

  // Keep references to current state to avoid closure issues
  const messagesRef = useRef<ExtendedMessage[]>(messages);
  const branchStateRef = useRef<BranchState>(branchState);
  const currentIdRef = useRef<string | null>(currentId);

  // Update refs when state changes
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    branchStateRef.current = branchState;
  }, [branchState]);

  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  // Initialize currentId with the most recent message ID when messages change
  useEffect(() => {
    if (messages.length > 0 && currentId === null) {
      // Check if we already have a stored value
      const storedId =
        typeof window !== "undefined"
          ? localStorage.getItem(`chat-current-id-${chatId}`)
          : null;

      // Only set if no stored value exists
      if (!storedId) {
        console.log(
          "[useAIChat] - (useEffect) Setting currentId to:",
          messages[messages.length - 1].id
        );
        setCurrentId(messages[messages.length - 1].id);
      } else {
        console.log(
          "[useAIChat] - (useEffect) Using stored currentId:",
          storedId
        );
      }
    }
  }, [messages, currentId, setCurrentId, chatId]);

  useEffect(() => {
    console.log("[useAIChat] currentId is currently set to", currentId);
  }, [currentId]);

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

  // Create throttled versions of mutate functions
  const throttledMutateMessages = useCallback(
    (
      newMessagesOrFn:
        | ExtendedMessage[]
        | ((messages: ExtendedMessage[]) => ExtendedMessage[]),
      shouldRevalidate = false
    ) => {
      // Use setTimeout instead of throttle for testing
      setTimeout(() => {
        mutateMessages(newMessagesOrFn as any, shouldRevalidate);
      }, 0);
    },
    [mutateMessages]
  );

  /**
   * Handle incoming message updates during streaming
   */
  const handleUpdate = useCallback(
    ({
      message,
      replaceLastMessage,
    }: {
      message: ExtendedMessage;
      replaceLastMessage: boolean;
    }) => {
      // Update status to streaming
      mutateStatus("streaming");

      // Process parent-child relationships for incoming message
      throttledMutateMessages((currentMessages) => {
        if (replaceLastMessage && currentMessages.length > 0) {
          // If replacing last message, we need to handle the update differently
          const lastMessageIndex = currentMessages.length - 1;
          const lastMessage = currentMessages[lastMessageIndex];

          // Only replace if it's an assistant message (standard streaming behavior)
          if (lastMessage.role === "assistant") {
            // Create a copy of the messages array
            const updatedMessages = [...currentMessages];

            // Preserve the existing parent_id and children_ids for the assistant message
            const updatedMessage = {
              ...message,
              parent_id: message.parent_id || lastMessage.parent_id,
              children_ids: lastMessage.children_ids || [],
            };

            // Replace the last message
            updatedMessages[lastMessageIndex] = updatedMessage;

            return updatedMessages;
          }
        }

        // This is a new message or we're not replacing, establish relationships
        return establishRelationshipsForNewMessage(currentMessages, message, {
          modelId: model,
          parentMessageId: message.parent_id || undefined,
        });
      }, false);
    },
    [throttledMutateMessages, mutateStatus, model]
  );

  /**
   * Trigger a request to the AI API
   */
  const triggerRequest = useCallback(
    async ({
      messages,
      headers: reqHeaders,
      body: reqBody,
      chatRequestOptions,
      attachments,
    }: {
      messages: ExtendedMessage[];
      headers?: Record<string, string>;
      body?: Record<string, any>;
      chatRequestOptions?: ExtendedRequestOptions;
      attachments?: Attachment[];
    }) => {
      console.log("[useAIChat] triggerRequest called with:", {
        messageCount: messages.length,
        hasHeaders: !!reqHeaders,
        hasBody: !!reqBody,
        hasChatRequestOptions: !!chatRequestOptions,
        hasAttachments: !!attachments,
      });

      try {
        mutateStatus("submitted");

        await executeBeforeRequestMiddleware(
          messages as ExtendedMessage[],
          middlewaresRef.current
        );

        // Create a new abort controller for this request
        abortControllerRef.current = new AbortController();

        const currentMessages = messagesRef.current;

        const processedMessages = messages.map((msg) => {
          const existingMsg = currentMessages.find((m) => m.id === msg.id);
          if (existingMsg) {
            // Use existing message but ensure parent_id is preserved
            const processed = ensureExtendedMessage(msg as Message);

            // Ensure parent_id is preserved from the existing message if not explicitly set
            if (!processed.parent_id && existingMsg.parent_id) {
              processed.parent_id = existingMsg.parent_id;
            }

            return processed;
          }

          const parentMessageId =
            (msg as ExtendedMessage).parent_id ||
            chatRequestOptions?.options?.parentMessageId;

          // Log for debugging
          console.log("[useAIChat] Processing new message:", {
            id: msg.id,
            role: msg.role,
            parentMessageId: parentMessageId,
          });

          return ensureExtendedMessage(
            establishRelationshipsForNewMessage(
              currentMessages,
              msg as ExtendedMessage,
              {
                modelId:
                  metaRef.current.model || chatRequestOptions?.options?.modelId,
                parentMessageId: parentMessageId,
              }
            ).find((m) => m.id === msg.id) as ExtendedMessage
          );
        });

        console.log("[triggerRequest] Processed messages:", processedMessages);

        // Keep track of the original state for error recovery
        const previousMessages = [...currentMessages];
        console.log(
          "[useAIChat] Saved previous messages for potential recovery"
        );

        // Update the UI optimistically
        throttledMutateMessages(processedMessages as ExtendedMessage[], false);
        console.log("[useAIChat] Updated UI with processed messages");

        console.log(
          "[useAIChat] Formatted messages for API:",
          processedMessages
        );

        // Find the last message for context during streaming
        const lastMessage = processedMessages[
          processedMessages.length - 1
        ] as ExtendedMessage;

        await deps.chatAPIClient.streamChatMessages({
          messages: processedMessages,
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
            ...(chatRequestOptions?.options || {}),
          },
          attachments,
          getAbortController: () => abortControllerRef.current!,
          onResponse,
          onUpdate: handleUpdate,
          onStreamPart: (part, delta, type) => {
            if (onStreamPart) {
              onStreamPart(part, delta, type);
            }
          },
          onFinish: async (message, finishReason) => {
            // Log detailed message info for debugging
            console.log("[useAIChat] Stream finished:", {
              id: message.id,
              role: message.role,
              parent_id: message.parent_id,
              finishReason,
            });

            await executeAfterRequestMiddleware(
              messagesRef.current,
              middlewaresRef.current
            );

            mutateStatus("ready");
            setCurrentId(message.id);

            deps.logger.debug("Chat message stream finished", {
              module: "useAIChat",
              context: {
                messageId: message.id,
                finishReason,
                modelUsed: message.model,
              },
            });

            // Clear abort controller
            abortControllerRef.current = null;

            // Call user-provided onFinish callback if available
            if (onFinish) {
              try {
                onFinish(message, finishReason);
              } catch (error) {
                deps.logger.error(
                  "Error in user-provided onFinish callback",
                  error instanceof Error ? error : new Error(String(error)),
                  { module: "useAIChat" }
                );
              }
            }
          },
          onToolCall,
          onError: async (error) => {
            // Execute error middleware
            await executeOnRequestErrorMiddleware(
              error,
              messagesRef.current,
              middlewaresRef.current
            );

            // Set status to error
            mutateStatus("error");

            // Call user error handler if provided
            if (onError) {
              try {
                onError(error);
              } catch (callbackError) {
                handleError(callbackError, "useAIChat", {
                  context: "Error in onError callback",
                  originalError: error.message,
                });
              }
            }
          },
          restoreMessagesOnFailure: !keepLastMessageOnError
            ? () =>
                throttledMutateMessages(
                  previousMessages as ExtendedMessage[],
                  false
                )
            : undefined,
          replaceLastMessage: true, // Replace during streaming for UI updates
          lastMessage,
        });
        console.log("[useAIChat] streamChatMessages completed successfully");

        return lastMessage.id;
      } catch (err) {
        console.error("[useAIChat] Error in triggerRequest:", err);

        // Execute error middleware
        await executeOnRequestErrorMiddleware(
          err instanceof Error ? err : new Error(String(err)),
          messagesRef.current,
          middlewaresRef.current
        );

        // Ignore abort errors as they are expected
        if ((err as any).name === "AbortError") {
          abortControllerRef.current = null;
          mutateStatus("ready");
          return null;
        }

        // For other errors, set status to error
        mutateStatus("error");

        // For other errors, propagate them
        throw err;
      }
    },
    [
      chatId,
      api,
      model,
      streamProtocol,
      sendExtraMessageFields,
      keepLastMessageOnError,
      handleUpdate,
      throttledMutateMessages,
      mutateStatus,
      onResponse,
      onFinish,
      onStreamPart,
      onToolCall,
      onError,
      deps,
    ]
  );

  /**
   * Append a user message to the chat list and fetch the assistant's response.
   */
  const append = useCallback(
    async (
      message: ExtendedMessage,
      chatRequestOptions?: ExtendedRequestOptions
    ) => {
      deps.logger.debug("append called with message", {
        context: {
          messageId: message.id,
          content:
            message.content?.substring(0, 50) +
            (message.content && message.content.length > 50 ? "..." : ""),
          role: message.role,
        },
        module: "useAIChat",
      });

      try {
        // Set status to submitted immediately
        mutateStatus("submitted");

        // Sanitize the message before processing
        const sanitizedMessage = sanitizeMessage(message as Message);

        // Convert to ExtendedMessage
        const extendedMessage = ensureExtendedMessage(sanitizedMessage);

        // Store the current messages for potential rollback
        const previousMessages = messagesRef.current;

        // Get active messages for proper parent-child relationships
        const activeMessagesArray = currentIdRef.current
          ? getActivePathWithBranchState(
              previousMessages,
              currentIdRef.current,
              branchStateRef.current
            )
          : previousMessages;

        extendedMessage.parent_id =
          chatRequestOptions?.options?.parentMessageId;

        if (!extendedMessage.parent_id) {
          extendedMessage.parent_id = ensureParentRelationship(
            activeMessagesArray,
            extendedMessage
          );
        }

        deps.logger.debug("Extended message created", {
          context: { messageId: extendedMessage.id },
          module: "useAIChat",
        });

        // Update the messages state with the new user message
        const processedMessages = establishRelationshipsForNewMessage(
          activeMessagesArray,
          extendedMessage,
          {
            modelId: model,
            parentMessageId: message.parent_id || undefined,
          }
        );

        deps.logger.debug("Updated messages with relationships", {
          module: "useAIChat",
          context: { messageCount: processedMessages.length },
        });

        // Update the messages state IMMEDIATELY to show the user message in the UI
        throttledMutateMessages(processedMessages, false);

        // Update the form state
        if (
          chatRequestOptions?.body?.prompt === undefined &&
          extendedMessage.role === "user"
        ) {
          setInput("");
        }

        // If this is a user message and we have the callback, call it
        if (extendedMessage.role === "user" && onUserMessageProcessed) {
          try {
            // Wait for any database operations to complete
            await onUserMessageProcessed(extendedMessage, processedMessages);
          } catch (callbackError) {
            if (callbackError instanceof Error) {
              handleError(callbackError, "useAIChat", {
                context: "Error in onUserMessageProcessed callback",
                originalError: callbackError.message,
              });
            }
          }
        }

        // Handle network request and streaming
        const result = await triggerRequest({
          messages: processedMessages,
          headers: chatRequestOptions?.headers,
          body: chatRequestOptions?.body,
          chatRequestOptions: chatRequestOptions as ExtendedRequestOptions,
          attachments: chatRequestOptions?.experimental_attachments,
        });

        return result;
      } catch (error) {
        // Handle errors using our new utility
        const appError = handleError(error, "useAIChat", {
          messageId: message.id,
          role: message.role,
        });

        // Set error state for the hook
        setError(appError);
        mutateStatus("error");

        // Execute error middleware
        await executeOnRequestErrorMiddleware(
          appError,
          messagesRef.current,
          middlewaresRef.current
        );

        // Call user error handler if provided
        if (onError) {
          try {
            onError(appError);
          } catch (callbackError) {
            handleError(callbackError, "useAIChat", {
              context: "Error in onError callback",
              originalError: appError.message,
            });
          }
        }

        return null;
      }
    },
    [
      throttledMutateMessages,
      setInput,
      triggerRequest,
      model,
      setError,
      mutateStatus,
      onError,
      deps,
      onUserMessageProcessed,
    ]
  );

  /**
   * Reload the last AI chat response for the given chat history
   */
  const reload = useCallback(
    async (chatRequestOptions: ExtendedRequestOptions = {}) => {
      // Get the current messages
      const currentMessages = messagesRef.current;

      // Get active messages based on currentId
      const activeMessagesArray = currentIdRef.current
        ? getActivePathWithBranchState(
            currentMessages,
            currentIdRef.current,
            branchStateRef.current
          )
        : currentMessages;

      // Sanitize the messages before processing
      const sanitizedMessages = sanitizeUIMessages(activeMessagesArray);

      if (sanitizedMessages.length === 0) {
        return null;
      }

      // Get the last message in the chat
      const lastMessage = sanitizedMessages[sanitizedMessages.length - 1];

      let parentMessageId = chatRequestOptions.options?.parentMessageId;

      if (!parentMessageId) {
        parentMessageId =
          ensureParentRelationship(sanitizedMessages, lastMessage) ?? undefined;
      }

      // If the options include a parentMessageId, we're doing a branch/retry
      if (parentMessageId) {
        const parentIndex = sanitizedMessages.findIndex(
          (msg) => msg.id === parentMessageId
        );

        if (parentIndex >= 0) {
          // If we found the parent, keep messages up to and including the parent
          const messagesToKeep = sanitizedMessages.slice(0, parentIndex + 1);

          // Check for a preserved message ID - used for retries to preserve message history
          const preserveMessageId =
            chatRequestOptions.options?.preserveMessageId;

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
            chatRequestOptions: chatRequestOptions,
          });
        }
      }

      if (lastMessage.role === "assistant") {
        const lastUserMessageId = findLastUserMessageId(sanitizedMessages);
        if (lastUserMessageId) {
          const lastUserIndex = sanitizedMessages.findIndex(
            (msg) => msg.id === lastUserMessageId
          );
          if (lastUserIndex >= 0) {
            const messagesToSend = sanitizedMessages.slice(
              0,
              lastUserIndex + 1
            );
            return triggerRequest({
              messages: messagesToSend,
              headers: chatRequestOptions.headers,
              body: chatRequestOptions.body,
              chatRequestOptions: chatRequestOptions,
            });
          }
        }
        // Fallback to removing just the last assistant message
        return triggerRequest({
          messages: sanitizedMessages.slice(0, -1),
          headers: chatRequestOptions.headers,
          body: chatRequestOptions.body,
          chatRequestOptions: chatRequestOptions,
        });
      }

      // If last message is not an assistant message, send all messages
      return triggerRequest({
        messages: sanitizedMessages,
        headers: chatRequestOptions.headers,
        body: chatRequestOptions.body,
        chatRequestOptions: chatRequestOptions,
      });
    },
    [
      triggerRequest,
      throttledMutateMessages,
      messagesRef,
      currentIdRef,
      branchStateRef,
    ]
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
      throttledMutateMessages((currentMessages) => {
        // Handle both function and direct array updates
        const updatedMessages =
          typeof newMessages === "function"
            ? newMessages(currentMessages)
            : newMessages;

        // Sanitize messages before updating state
        const sanitizedMessages = sanitizeUIMessages(updatedMessages);

        // Ensure currentId points to a valid message after updating messages
        if (sanitizedMessages.length > 0) {
          // If current ID is not in the new message set, update it to the last message
          const messageExists = sanitizedMessages.some(
            (msg) => msg.id === currentIdRef.current
          );
          if (!messageExists || !currentIdRef.current) {
            setCurrentId(sanitizedMessages[sanitizedMessages.length - 1].id);
          }
        }

        return sanitizedMessages;
      }, false);
    },
    [throttledMutateMessages, currentIdRef, setCurrentId]
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
      e?: { preventDefault?: () => void },
      chatRequestOptions?: ExtendedRequestOptions
    ) => {
      try {
        if (!chatId) {
          throw new Error("Missing chat ID");
        }

        const isVlaidInput = input.trim();

        if (
          !isVlaidInput &&
          chatRequestOptions?.experimental_attachments?.length === 0
        ) {
          toast.error("Please enter a message or add an attachment");
          return;
        }

        const messageId = chatRequestOptions?.options?.preserveMessageId
          ? chatRequestOptions.options?.preserveMessageId
          : deps.idGenerator.generate();

        const userContent = input;

        setInput("");

        // Get the parent ID (last assistant message)
        const currentMessages = messagesRef.current;

        const newUserMessage = {
          id: messageId,
          role: "user",
          content: userContent,
          createdAt: new Date(),
        } as ExtendedMessage;

        // DEBUG: Log before parent relationship is established
        console.log("[DEBUG] User message before parent_id assignment:", {
          id: newUserMessage.id,
          role: newUserMessage.role,
          parent_id: newUserMessage.parent_id,
        });

        // Find a parent for the message
        newUserMessage.parent_id = ensureParentRelationship(
          currentMessages,
          newUserMessage
        );

        // DEBUG: Log after parent relationship is established
        console.log("[DEBUG] User message after parent_id assignment:", {
          id: newUserMessage.id,
          role: newUserMessage.role,
          parent_id: newUserMessage.parent_id,
          messageCount: currentMessages.length,
        });

        // List last 5 messages in the currentMessages array for context
        if (currentMessages.length > 0) {
          console.log(
            "[DEBUG] Last messages in context:",
            currentMessages.slice(-5).map((msg) => ({
              id: msg.id,
              role: msg.role,
              parent_id: (msg as ExtendedMessage).parent_id,
            }))
          );
        }

        await append(newUserMessage, {
          ...(chatRequestOptions || {}),
          experimental_attachments:
            chatRequestOptions?.experimental_attachments,
        } as ExtendedChatRequestOptions);
      } catch (error) {
        console.error("Error submitting chat request:", error);
        toast.error("An error occurred while submitting the chat request.");
      }
    },
    [input, append, setInput, deps, messagesRef]
  );

  // Compute active messages based on currentId and branchState
  const activeMessages = useMemo(() => {
    if (!currentId) {
      console.log("[useAIChat] No currentId, showing all messages:", {
        totalMessages: messages.length,
      });
      return messages;
    }

    // Use the utility from branching module to compute the active path with branch awareness
    const activePath = getActivePathWithBranchState(
      messages,
      currentId,
      branchState
    );

    console.log("[useAIChat] Active path computed:", {
      pathLength: activePath.length,
      fromCurrentId: currentId,
      totalMessages: messages.length,
      branchStateEntries: Object.keys(branchState).length,
    });

    return activePath;
  }, [messages, currentId, branchState]);

  // Log when active messages update
  useEffect(() => {
    console.log("[useAIChat] activeMessages updated:", {
      count: activeMessages.length,
      currentId,
    });
  }, [activeMessages, currentId]);

  /**
   * Switch to a different branch (alternative response) for a parent message.
   * This updates the branch state and sets the current message ID to the
   * appropriate leaf node in the selected branch.
   */
  const switchBranch = useCallback(
    (parentMessageId: string, branchIndex: number): void => {
      console.log(
        "[useAIChat] switchBranch called with parentMessageId:",
        parentMessageId,
        "and branchIndex:",
        branchIndex,
        "current branchState:",
        branchStateRef.current
      );

      // Check if we're already on this branch
      const currentBranchIndex = branchStateRef.current[parentMessageId];
      if (currentBranchIndex === branchIndex) {
        console.log(
          "[useAIChat] Already on branch index",
          branchIndex,
          "for parent",
          parentMessageId
        );
        return;
      }

      // Find the parent message and get the selected child ID
      const parentMessage = messagesRef.current.find(
        (msg) => msg.id === parentMessageId
      );

      console.log("[useAIChat] Parent message:", parentMessage);

      if (
        !parentMessage ||
        !parentMessage.children_ids ||
        parentMessage.children_ids.length <= branchIndex
      ) {
        console.error("[useAIChat] Invalid parent message or branch index:", {
          parentMessage,
          branchIndex,
          childrenLength: parentMessage?.children_ids?.length,
        });
        return;
      }

      const selectedChildId = parentMessage.children_ids[branchIndex];
      if (!selectedChildId) {
        console.error(
          "[useAIChat] No child found at branch index:",
          branchIndex
        );
        return;
      }

      // Create a new branch state with the updated selection
      const newBranchState = {
        ...branchStateRef.current,
        [parentMessageId]: branchIndex,
      };

      console.log(
        "[useAIChat] Selected child ID from parent message:",
        selectedChildId
      );

      // Immediately update the branch state
      mutateBranchState(newBranchState);

      // Create messages map for traversal
      const messagesMap = new Map(messagesRef.current.map((m) => [m.id, m]));

      // Compute the leaf node using the updated branch state
      const bottomLeafId = drillDownToLeafWithBranchState(
        selectedChildId,
        messagesMap,
        newBranchState // Use the new state directly
      );

      console.log(
        "[useAIChat] Setting currentId to leaf:",
        bottomLeafId,
        "using updated branch state"
      );

      setCurrentId(bottomLeafId);

      console.log(
        "[useAIChat] Switched branch to index:",
        branchIndex,
        "on parent:",
        parentMessageId,
        "and drilled down to leaf:",
        bottomLeafId
      );
    },
    [mutateBranchState, setCurrentId, messagesRef, branchStateRef]
  );

  /**
   * Get information about branches for a parent message.
   * Returns the current branch index and total number of branches.
   *
   * @param parentMessageId - ID of the parent message to get branch info for
   * @returns Object containing currentIndex (selected branch) and totalBranches
   */
  const getBranchInfo = useCallback(
    (parentMessageId: string) => {
      // Use the utility from branching module that doesn't rely on currentId
      return getBranchInfoFromState(
        messagesRef.current,
        parentMessageId,
        branchStateRef.current
      );
    },
    [branchStateRef]
  );

  /**
   * Retry a specific assistant message to get an alternative response.
   * This creates a new branch from the parent message.
   */
  const retryMessage = useCallback(
    async (messageId: string) => {
      console.log("[useAIChat] retryMessage called with messageId:", messageId);

      // Use utility to prepare state for retry
      const {
        messages: updatedMessages,
        messageToRetry,
        parentMessageId,
      } = prepareRetryState(messagesRef.current, messageId, model);

      // If preparation failed, abort
      if (!messageToRetry || !parentMessageId) {
        console.error(
          "[useAIChat] Could not prepare for retry - missing message or parent"
        );
        return null;
      }

      console.log("[useAIChat] Message to retry:", messageToRetry);
      console.log("[useAIChat] Parent message ID:", parentMessageId);

      // Update the message state to preserve content during retry
      throttledMutateMessages(() => updatedMessages, false);

      // Store the current message properties for preservation
      const messageContent = messageToRetry.content;
      const messageParts = messageToRetry.parts || [];
      const messageData = messageToRetry.data || {};
      const messageModel = messageToRetry.model || model || "unknown";

      // Generate a random seed to prevent cached responses from the model
      const randomSeed = Math.floor(Math.random() * 1000000).toString();

      const result = await reload({
        options: {
          parentMessageId,
          preserveMessageId: messageToRetry.id,
        },
        headers: {
          "x-random-seed": randomSeed,
        },
        body: {
          seed: randomSeed,
          temperature: 0.6,
        },
      });

      // After the reload completes, preserve the original message content
      setTimeout(() => {
        throttledMutateMessages((prevMessages) => {
          return preserveMessageContent(
            prevMessages,
            messageId,
            messageContent,
            messageParts,
            messageData,
            messageModel
          );
        }, false);
      }, 500); // Small delay to ensure this runs after the reload response is processed

      return result;
    },
    [reload, throttledMutateMessages, model, setCurrentId]
  );

  /**
   * Continue the specified assistant message from where it left off.
   * The continued content will be streamed to the same message.
   */
  const continueMessage = useCallback(
    async (messageId: string) => {
      const messageToContinue = messagesRef.current.find(
        (msg) => msg.id === messageId && msg.role === "assistant"
      );

      if (!messageToContinue) {
        console.error("[useAIChat] Could not find message to continue");
        return null;
      }

      const parentMessageId = messageToContinue.parent_id;

      if (!parentMessageId) {
        console.error("[useAIChat] Could not find parent message");
        return null;
      }

      const originalContent = messageToContinue.content;

      const originalMessages = [...messagesRef.current];

      mutateStatus("submitted");

      const currentMessages = messagesRef.current;

      // Get active messages based on currentId
      const activeMessagesArray = currentIdRef.current
        ? getActivePathWithBranchState(
            currentMessages,
            currentIdRef.current,
            branchStateRef.current
          )
        : currentMessages;

      const parentIndex = activeMessagesArray.findIndex(
        (msg) => msg.id === parentMessageId
      );

      if (parentIndex < 0) {
        console.error(
          "[useAIChat] Parent message not found in active messages"
        );
        return null;
      }

      const messagesUpToParent = activeMessagesArray.slice(0, parentIndex + 1);

      const systemMessage = {
        id: deps.idGenerator.generate(),
        role: "system" as const,
        content: continuePrompt,
        createdAt: new Date().toISOString(), // Add createdAt timestamp
      };

      const promptMessages = [...messagesUpToParent, systemMessage];

      const validatedPromptMessages = promptMessages.map((msg) => {
        const baseMessage = {
          id: msg.id || deps.idGenerator.generate(),
          role: msg.role,
          content: msg.content || "",
          createdAt: msg.createdAt || new Date().toISOString(),
        };

        const additionalProps: Record<string, any> = {};
        Object.keys(msg).forEach((key) => {
          if (
            !["id", "role", "content", "createdAt"].includes(key) &&
            msg[key as keyof typeof msg] !== undefined
          ) {
            additionalProps[key] = msg[key as keyof typeof msg];
          }
        });

        return {
          ...baseMessage,
          ...additionalProps,
        };
      });

      try {
        throttledMutateMessages(() => {
          return originalMessages.map((msg) => {
            if (msg.id === messageId) {
              return {
                ...msg,
                content: originalContent, // Don't add ellipsis, keep original content
                isLoading: true,
              };
            }
            return msg;
          });
        }, false);

        const randomSeed = Math.floor(Math.random() * 1000000).toString();

        const customOnUpdate = (update: {
          message: ExtendedMessage;
          replaceLastMessage: boolean;
        }) => {
          throttledMutateMessages(() => {
            return originalMessages.map((msg) => {
              if (msg.id === messageId) {
                const continuationContent = update.message.content;

                return {
                  ...msg,
                  content: combineContent(originalContent, continuationContent),
                  isLoading: true,
                };
              }
              return msg;
            });
          }, false);
        };

        console.log("[useAIChat] Continue request payload:", {
          messageCount: validatedPromptMessages.length,
          firstMessage: validatedPromptMessages[0],
          lastMessage:
            validatedPromptMessages[validatedPromptMessages.length - 1],
        });

        await deps.chatAPIClient.streamChatMessages({
          messages: validatedPromptMessages as ExtendedMessage[],
          id: chatId,
          model: model || "unknown",
          api,
          streamProtocol,
          headers: {
            ...metaRef.current.headers,
            "x-continue-message-id": messageId,
            "x-random-seed": randomSeed,
          },
          body: {
            ...metaRef.current.body,
            continueMessageId: messageId,
            originalContent,
            seed: randomSeed,
            // Add a flag to indicate this is a continuation, not a new message
            isContinuation: true,
          },
          getAbortController: () => abortControllerRef.current!,
          onResponse: async (response) => {
            if (!response.ok) {
              let errorDetails = "";
              try {
                const errorData = await response.json();
                errorDetails = JSON.stringify(errorData, null, 2);
              } catch (e) {
                errorDetails = await response.text();
              }

              console.error(
                `[useAIChat] API error during continue: ${response.status} ${response.statusText}`,
                errorDetails
              );

              throttledMutateMessages(() => {
                return originalMessages.map((msg) => {
                  if (msg.id === messageId) {
                    return {
                      ...msg,
                      content: combineContent(
                        originalContent,
                        " [Error: Could not continue message]"
                      ),
                      isLoading: false,
                    };
                  }
                  return msg;
                });
              }, false);

              // Set error state
              setError(
                new Error(
                  `API error: ${response.status} ${response.statusText}`
                )
              );
              mutateStatus("error");

              // Call original onResponse if provided
              if (onResponse) {
                onResponse(response);
              }

              // Throw error to skip the rest of the process
              throw new Error(
                `API error: ${response.status} ${response.statusText}`
              );
            }

            // Call original onResponse if provided
            if (onResponse) {
              onResponse(response);
            }
          },
          // Don't use the standard update handler, use our custom one
          onUpdate: customOnUpdate,
          onStreamPart,
          onFinish: async (message, finishReason) => {
            mutateStatus("ready");
            abortControllerRef.current = null;
          },
        });

        return messageId;
      } catch (err) {
        const error = err as Error;
        console.error("[useAIChat] continue error:", error);

        // Make sure we reset the UI state
        throttledMutateMessages(() => {
          // Restore all original messages but update the continued message with error
          return originalMessages.map((msg) => {
            if (msg.id === messageId) {
              return {
                ...msg,
                content: combineContent(
                  originalContent,
                  " [Error: " +
                    (error.message || "Could not continue response") +
                    "]"
                ),
                isLoading: false,
              };
            }
            return msg;
          });
        }, false);

        setError(error);
        mutateStatus("error");

        if (onError) {
          onError(error);
        }

        return null;
      }
    },
    [
      model,
      api,
      streamProtocol,
      chatId,
      messagesRef,
      throttledMutateMessages,
      setError,
      mutateStatus,
      onResponse,
      onStreamPart,
      onFinish,
      onError,
      deps.idGenerator,
      deps.chatAPIClient,
      handleUpdate,
      metaRef,
      abortControllerRef,
      setCurrentId,
      currentIdRef,
    ]
  );

  return {
    messages,
    activeMessages,
    error,
    append,
    reload,
    continue: continueMessage,
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
    currentId,
  };
}
