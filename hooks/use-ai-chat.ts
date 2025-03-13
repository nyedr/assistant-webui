"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Message, Attachment } from "ai";
import type { RequestOptions as AIRequestOptions } from "ai";
import useSWR from "swr";
import { StreamProtocol } from "@/lib/types/chat";
import {
  ExtendedChatRequestOptions,
  ensureExtendedMessage,
  ExtendedMessage,
} from "@/lib/utils/messages";
import { handleError } from "@/lib/utils/error-handling";
import {
  establishMessageRelationships,
  establishRelationshipsForNewMessage,
} from "@/lib/messages/relationships";
import {
  sanitizeMessage,
  sanitizeUIMessages,
} from "@/lib/messages/sanitization";
import { findLastUserMessageId } from "@/lib/messages/queries";
import {
  getBranchInfo as getMessageBranchInfo,
  selectBranch,
  prepareRetryState,
  preserveMessageContent,
} from "@/lib/messages/branching";
import type { BranchState } from "@/lib/messages/branching";
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

export type ChatRequestOptions = AIRequestOptions & {
  headers?: Record<string, string>;
  body?: Record<string, any>;
  experimental_attachments?: Attachment[];
};

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
  retryMessage: (messageId: string) => Promise<string | null>;
  /** The id of the chat */
  id: string;
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
  middleware,
  dependencies,
  experimental_throttle,
  onResponse,
  onFinish,
  onError,
  onStreamPart,
  onToolCall,
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

  // Store which branch index is currently visible for each parent message
  const { data: branchState = {}, mutate: mutateBranchState } =
    useSWR<BranchState>([chatId, "branchState"], null, {
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
        // If we should replace the last message (e.g., during streaming)
        if (replaceLastMessage) {
          const lastMessageIndex = currentMessages.length - 1;

          // If there are no messages or the last one isn't from the assistant, just append
          if (
            lastMessageIndex < 0 ||
            currentMessages[lastMessageIndex].role !== "assistant"
          ) {
            // This is a new message, so establish parent-child relationships
            return establishRelationshipsForNewMessage(
              currentMessages,
              message,
              { modelId: model }
            );
          } else {
            // Replace the last message but keep its relationship properties
            const updatedMessages = [...currentMessages];
            const existingMessage = updatedMessages[lastMessageIndex];

            updatedMessages[lastMessageIndex] = {
              ...message,
              // Preserve relationship data
              parent_id: existingMessage.parent_id || message.parent_id,
              children_ids: existingMessage.children_ids || [],
            };

            // Ensure parent-child relationships are properly established
            return establishRelationshipsForNewMessage(
              updatedMessages.slice(0, -1),
              updatedMessages[lastMessageIndex],
              { preserveMessageId: updatedMessages[lastMessageIndex].id }
            );
          }
        } else {
          // This is a new message, establish parent-child relationships
          return establishRelationshipsForNewMessage(currentMessages, message, {
            modelId: model,
          });
        }
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
      options,
      attachments,
    }: {
      messages: Message[] | ExtendedMessage[];
      headers?: Record<string, string>;
      body?: Record<string, any>;
      options?: ExtendedRequestOptions;
      attachments?: Attachment[];
    }) => {
      console.log("[useAIChat] triggerRequest called with:", {
        messageCount: messages.length,
        hasHeaders: !!reqHeaders,
        hasBody: !!reqBody,
        hasOptions: !!options,
        hasAttachments: !!attachments,
      });

      try {
        // Set status to submitted immediately at the start of the request
        mutateStatus("submitted");

        // Execute before-request middleware if any exists
        await executeBeforeRequestMiddleware(
          messages as ExtendedMessage[],
          middlewaresRef.current
        );

        // Create a new abort controller for this request
        abortControllerRef.current = new AbortController();
        console.log("[useAIChat] Created new abort controller");

        // Process messages to ensure they have proper relationships
        const currentMessages = messagesRef.current;
        console.log(
          "[useAIChat] Current message count:",
          currentMessages.length
        );

        // Process messages to ensure they have proper relationships
        const processedMessages = messages.map((msg) => {
          // If the message is already in the current messages, keep it as is
          const existingMsg = currentMessages.find((m) => m.id === msg.id);
          if (existingMsg) {
            console.log("[useAIChat] Using existing message:", msg.id);
            return ensureExtendedMessage(msg as Message);
          }

          console.log(
            "[useAIChat] Preparing message relationships for:",
            msg.id
          );
          // Otherwise, establish appropriate relationships
          return ensureExtendedMessage(
            establishRelationshipsForNewMessage(
              currentMessages,
              msg as Message,
              { modelId: metaRef.current.model || "" }
            ).find((m) => m.id === msg.id) as Message
          );
        });

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
        console.log("[useAIChat] Last message ID:", lastMessage.id);

        console.log("[useAIChat] Calling adaptCallChatApi");
        // Stream the message to the API
        await deps.chatAPIClient.streamChatMessages({
          messages: processedMessages as ExtendedMessage[], // Use type assertion to bypass type checking
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
          getAbortController: () => abortControllerRef.current!,
          onResponse,
          onUpdate: handleUpdate,
          onStreamPart: (part, delta, type) => {
            // No middleware transformation, just call the original handler
            if (onStreamPart) {
              onStreamPart(part, delta, type);
            }
          },
          onFinish: async (message, finishReason) => {
            console.log("[useAIChat] Stream finished", {
              messageId: message.id,
              finishReason,
            });

            // Execute after-request middleware
            await executeAfterRequestMiddleware(
              messagesRef.current,
              middlewaresRef.current
            );

            // Set status to ready
            mutateStatus("ready");

            // Log finish information with detailed context
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

        // Return the ID of the last message
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
      message: Message | Partial<ExtendedMessage>,
      options?: ChatRequestOptions
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

        // Set parent_id for user messages if not already set
        if (extendedMessage.role === "user" && !extendedMessage.parent_id) {
          // Find the last assistant message to use as parent
          for (let i = previousMessages.length - 1; i >= 0; i--) {
            if (previousMessages[i].role === "assistant") {
              extendedMessage.parent_id = previousMessages[i].id;
              break;
            }
          }
        }

        // For assistant messages, set parent to the last user message if not already set
        if (
          extendedMessage.role === "assistant" &&
          !extendedMessage.parent_id
        ) {
          const lastUserMessageId = findLastUserMessageId(previousMessages);
          if (lastUserMessageId) {
            extendedMessage.parent_id = lastUserMessageId;
          }
        }

        // Ensure createdAt is a string (ISO format)
        if (extendedMessage.createdAt instanceof Date) {
          (extendedMessage as any).createdAt =
            extendedMessage.createdAt.toISOString();
        }

        deps.logger.debug("Extended message created", {
          context: { messageId: extendedMessage.id },
          module: "useAIChat",
        });

        // Update the messages state with the new user message
        const processedMessages = establishRelationshipsForNewMessage(
          previousMessages,
          extendedMessage,
          { modelId: model }
        );

        deps.logger.debug("Updated messages with relationships", {
          module: "useAIChat",
          context: { messageCount: processedMessages.length },
        });

        // Update the messages state
        throttledMutateMessages(processedMessages, false);

        // Update the form state
        if (
          options?.body?.prompt === undefined &&
          extendedMessage.role === "user"
        ) {
          setInput("");
        }

        // Handle network request and streaming
        const result = await triggerRequest({
          messages: processedMessages,
          headers: options?.headers,
          body: options?.body,
          options: options as ExtendedRequestOptions,
          attachments: options?.experimental_attachments,
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
    ]
  );

  /**
   * Reload the last AI chat response for the given chat history
   */
  const reload = useCallback(
    async (chatRequestOptions: ExtendedRequestOptions = {}) => {
      // Get the current messages
      const currentMessages = messagesRef.current;

      // Sanitize the messages before processing
      const sanitizedMessages = sanitizeUIMessages(currentMessages);

      if (sanitizedMessages.length === 0) {
        return null;
      }

      // Get the last message in the chat
      const lastMessage = sanitizedMessages[sanitizedMessages.length - 1];

      // If the options include a parentMessageId, we're doing a branch/retry
      if (chatRequestOptions.options?.parentMessageId) {
        const parentMessageId = chatRequestOptions.options.parentMessageId;
        const parentIndex = sanitizedMessages.findIndex(
          (msg) => msg.id === parentMessageId
        );

        if (parentIndex >= 0) {
          // If we found the parent, keep messages up to and including the parent
          const messagesToKeep = sanitizedMessages.slice(0, parentIndex + 1);

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

      // For standard reload, use findLastUserMessageId to find the last user message
      // if the last message is an assistant message
      if (lastMessage.role === "assistant") {
        const lastUserMessageId = findLastUserMessageId(sanitizedMessages);
        if (lastUserMessageId) {
          // Find all messages up to and including the last user message
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
              options: chatRequestOptions,
            });
          }
        }
        // Fallback to removing just the last assistant message
        return triggerRequest({
          messages: sanitizedMessages.slice(0, -1),
          headers: chatRequestOptions.headers,
          body: chatRequestOptions.body,
          options: chatRequestOptions,
        });
      }

      // If last message is not an assistant message, send all messages
      return triggerRequest({
        messages: sanitizedMessages,
        headers: chatRequestOptions.headers,
        body: chatRequestOptions.body,
        options: chatRequestOptions,
      });
    },
    [triggerRequest, throttledMutateMessages, messagesRef]
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
        return sanitizeUIMessages(updatedMessages);
      }, false);
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
      e?: { preventDefault?: () => void },
      chatRequestOptions?: ExtendedRequestOptions
    ) => {
      console.log("[useAIChat] handleSubmit called", {
        input,
        chatRequestOptions,
      });

      if (e?.preventDefault) {
        e.preventDefault();
      }

      if (!input) {
        console.log("[useAIChat] Empty input, not submitting");
        return;
      }

      const userMessage: ExtendedMessage = {
        id: deps.idGenerator.generate(),
        role: "user",
        content: input,
        createdAt: new Date(), // This should now be a Date object
        parent_id: null,
        children_ids: [],
      };

      console.log("[useAIChat] Created user message", userMessage);

      setInput("");

      try {
        console.log("[useAIChat] Calling append with user message");
        return await append(userMessage, chatRequestOptions);
      } catch (error) {
        console.error("[useAIChat] Error in handleSubmit:", error);
        throw error;
      }
    },
    [input, append, setInput, deps]
  );

  /**
   * Switch to a different branch (alternative response) for a parent message
   */
  const switchBranch = useCallback(
    (parentMessageId: string, branchIndex: number) => {
      // Update the branch state to show the selected branch index
      mutateBranchState((prevState) => ({
        ...prevState,
        [parentMessageId]: branchIndex,
      }));

      // Update messages using the selectBranch utility function
      throttledMutateMessages((prevMessages) => {
        return selectBranch(prevMessages, parentMessageId, branchIndex);
      }, false);
    },
    [messages, mutateBranchState, throttledMutateMessages]
  );

  /**
   * Get information about branches for a parent message
   */
  const getBranchInfo = useCallback((parentMessageId: string) => {
    // Use the utility function from branching module
    return getMessageBranchInfo(
      messagesRef.current,
      parentMessageId,
      branchStateRef.current
    );
  }, []);

  /**
   * Retry a specific assistant message to get an alternative response
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
    [reload, throttledMutateMessages, model]
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
      const parentIndex = currentMessages.findIndex(
        (msg) => msg.id === parentMessageId
      );

      if (parentIndex < 0) {
        console.error(
          "[useAIChat] Parent message not found in current messages"
        );
        return null;
      }

      const messagesUpToParent = currentMessages.slice(0, parentIndex + 1);

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
            // Final update to remove loading indicator while preserving all messages
            throttledMutateMessages(() => {
              // Use the original messages as a base and update only the continued message
              return originalMessages.map((msg) => {
                if (msg.id === messageId) {
                  const updatedMsg = messagesRef.current.find(
                    (m) => m.id === messageId
                  );

                  const continuationContent = updatedMsg
                    ? updatedMsg.content.substring(originalContent.length)
                    : "";

                  return {
                    ...msg,
                    content: updatedMsg
                      ? combineContent(originalContent, continuationContent)
                      : msg.content,
                    isLoading: false,
                  };
                }
                return msg;
              });
            }, false);

            // Set status to ready
            mutateStatus("ready");

            // Call the original onFinish if provided
            if (onFinish) {
              // Find the updated message to pass to onFinish
              const updatedMessage = messagesRef.current.find(
                (msg) => msg.id === messageId
              );
              if (updatedMessage) {
                onFinish(updatedMessage, finishReason);
              }
            }

            // Final check to ensure we haven't lost any messages
            setTimeout(() => {
              if (messagesRef.current.length < originalMessages.length) {
                console.warn(
                  "[useAIChat] Message count decreased after continuation, restoring original messages"
                );
                throttledMutateMessages(() => {
                  // Use the original messages as a base and update only the continued message
                  return originalMessages.map((msg) => {
                    if (msg.id === messageId) {
                      // Find the current version of this message to get the updated content
                      const updatedMsg = messagesRef.current.find(
                        (m) => m.id === messageId
                      );

                      // Get the continuation content
                      const continuationContent = updatedMsg
                        ? updatedMsg.content.substring(originalContent.length)
                        : "";

                      return {
                        ...msg,
                        // Use the combineContent function to ensure seamless continuation
                        content: updatedMsg
                          ? combineContent(originalContent, continuationContent)
                          : msg.content,
                        isLoading: false,
                      };
                    }
                    return msg;
                  });
                }, false);
              }
            }, 500); // Small delay to ensure this runs after any other updates
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
    ]
  );

  return {
    messages,
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
  };
}
