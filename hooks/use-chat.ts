"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSWRConfig } from "swr";
import { useChatStream, ToolCallPayload } from "./use-api";
import { generateUUID } from "@/lib/utils";
import useSWR from "swr";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatHistory {
  currentId: string | null;
  messages: ChatMessage[];
}

export interface Function {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCall {
  function: Function;
}

export interface Attachment {
  url: string;
  name: string;
  contentType: string;
  type: string;
  data?: ArrayBuffer;
}

export interface BaseMessage {
  role: ChatRole;
  content: string;
  metadata?: {
    id: string;
    parent_id: string | null;
    children_ids: string[];
    timestamp: number;
    model: string | null;
    [key: string]: unknown;
  };
}

export interface AssistantMessage extends BaseMessage {
  role: "assistant";
  type?: "chunk";
  tool_calls?: ToolCall[];
}

export interface UserMessage extends BaseMessage {
  role: "user";
  images?: string[];
}

export interface SystemMessage extends BaseMessage {
  role: "system";
}

export interface ToolMessage extends BaseMessage {
  role: "tool";
  name: string;
  tool_call_id?: string;
}

export type StrictChatMessage =
  | AssistantMessage
  | UserMessage
  | SystemMessage
  | ToolMessage;

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  parent_id: string | null;
  children_ids: string[];
  timestamp: number;
  model: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  metadata?: Record<string, unknown>;
  experimental_attachments?: Attachment[];
  images: string[];
  files: string[];
}

export type CreateMessage = Pick<ChatMessage, "content" | "role" | "name">;

export interface ChatRequestOptions {
  experimental_attachments?: Attachment[];
  [key: string]: unknown;
}

export type UpdateMessages = (
  messages: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])
) => void;

export interface StreamConfig {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  enable_tools?: boolean;
  enable_memory?: boolean;
  filters?: string[];
  pipeline?: string;
  speak_aloud?: boolean;
  tts_voice?: string;
}

export interface ChatHookConfig {
  id?: string;
  initialMessages?: ChatMessage[];
  config?: Omit<StreamConfig, "id">;
  onResponse?: (response: Response) => void | Promise<void>;
  onFinish?: (message: ChatMessage) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export interface ChatHookResult {
  messages: ChatMessage[];
  setMessages: UpdateMessages;
  append: (
    message: ChatMessage | CreateMessage,
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  reload: () => Promise<void>;
  stop: () => void;
  input: string;
  setInput: (value: string) => void;
  handleSubmit: (
    e?: React.FormEvent<HTMLFormElement>,
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<void>;
  isLoading: boolean;
}

export function useChat({
  id,
  initialMessages = [],
  config = {},
  onFinish,
  onError,
}: ChatHookConfig): ChatHookResult {
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  const [messages, setMessages] = useState<ChatMessage[]>(messagesRef.current);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { mutate } = useSWRConfig();
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const isStreamingRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveRef = useRef<number>(0);
  const pendingSaveRef = useRef<ChatMessage[] | null>(null);

  // Use SWR to cache messages with longer stale time
  const { data: cachedMessages, mutate: mutateMessages } = useSWR<
    ChatMessage[]
  >(id ? `chat-messages-${id}` : null, null, {
    fallbackData: messages,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 300000, // 5 minutes
  });

  // Sync messages with SWR cache
  useEffect(() => {
    if (cachedMessages) {
      messagesRef.current = cachedMessages;
      setMessages(cachedMessages);
    }
  }, [cachedMessages]);

  // Track mount state and cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // If we have pending saves, try to save them
      if (pendingSaveRef.current && id) {
        fetch(`/api/chat?id=${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pendingSaveRef.current),
        }).catch(console.error);
      }

      // Only cleanup if not streaming
      if (!isStreamingRef.current) {
        isMountedRef.current = false;
      }
    };
  }, [id]);

  const updateMessages = useCallback(
    async (
      updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
    ) => {
      // Allow updates during streaming even if unmounted
      if (!isMountedRef.current && !isStreamingRef.current) {
        console.log(
          "[Chat] Skipping update - component unmounted and not streaming"
        );
        return;
      }

      // First update the ref and pending save
      const prevMessages = messagesRef.current;
      const nextMessages =
        typeof updater === "function" ? updater(prevMessages) : updater;
      messagesRef.current = nextMessages;
      pendingSaveRef.current = nextMessages;

      // Update SWR cache immediately
      if (id) {
        await mutateMessages(nextMessages, false);
      }

      // Save to database with debouncing and retries
      if (id) {
        const now = Date.now();
        if (now - lastSaveRef.current >= 1000) {
          lastSaveRef.current = now;
          try {
            const response = await fetch(`/api/chat?id=${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(nextMessages),
            });

            if (!response.ok) {
              throw new Error(`Failed to save messages: ${response.status}`);
            }

            console.log("[Chat] Saved messages to chat history");
            pendingSaveRef.current = null;

            // Revalidate without rerender
            await mutate(`/api/chat/${id}`, undefined, {
              revalidate: false,
            });
          } catch (error) {
            console.error("[Chat] Failed to save messages:", error);
            // Keep messages in pending save
            pendingSaveRef.current = nextMessages;
          }
        } else {
          // Debounce save
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
          }
          saveTimeoutRef.current = setTimeout(async () => {
            await updateMessages(nextMessages);
          }, 1000);
        }
      }

      // Only update state if mounted or streaming
      if (isMountedRef.current || isStreamingRef.current) {
        setMessages(nextMessages);
      }
    },
    [id, mutate, mutateMessages]
  );

  const { startStream } = useChatStream({
    onMessage: useCallback(
      (content: string) => {
        console.log("[Chat] Received message content:", content);

        updateMessages((currentMessages) => {
          const lastMessage = currentMessages[currentMessages.length - 1];

          // If there's no last message or it's not from assistant, create new one
          if (!lastMessage || lastMessage.role !== "assistant") {
            const newMessage: ChatMessage = {
              role: "assistant",
              content,
              id: generateUUID(),
              parent_id: lastMessage?.id || null,
              children_ids: [],
              timestamp: Date.now(),
              model: config.model || null,
              images: [],
              files: [],
            };
            console.log("[Chat] Creating new assistant message:", {
              messageId: newMessage.id,
              content: newMessage.content,
            });

            return [...currentMessages, newMessage];
          }

          // Update existing assistant message
          return currentMessages.map((msg, index) => {
            if (index === currentMessages.length - 1) {
              return {
                ...msg,
                content: msg.content + content,
                model: config.model || msg.model,
              };
            }
            return msg;
          });
        });
      },
      [updateMessages, config.model]
    ),
    onToolCall: useCallback(
      (tool: ToolCallPayload) => {
        updateMessages((currentMessages) => {
          const lastMessage = currentMessages[currentMessages.length - 1];
          if (lastMessage?.role === "assistant") {
            return currentMessages.map((msg, index) => {
              if (index === currentMessages.length - 1) {
                return {
                  ...msg,
                  tool_calls: [
                    ...(msg.tool_calls || []),
                    {
                      function: {
                        name: tool.function.name,
                        arguments: JSON.parse(tool.function.arguments),
                      },
                    },
                  ],
                };
              }
              return msg;
            });
          }
          return currentMessages;
        });
      },
      [updateMessages]
    ),
    onPhaseStart: useCallback(() => {
      if (!isMountedRef.current) return;
      console.log("[Chat] Stream started");
      isStreamingRef.current = true;
      setIsLoading(true);
    }, []),
    onPhaseComplete: useCallback(async () => {
      console.log("[Chat] Stream complete");

      try {
        // Clear any pending save timeouts
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }

        // Final save of messages
        if (id) {
          const finalMessages = messagesRef.current;
          try {
            await fetch(`/api/chat?id=${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(finalMessages),
            });
            console.log("[Chat] Final save of messages complete");

            // Update SWR cache and revalidate
            await mutateMessages(finalMessages, false);
            await mutate(`/api/chat/${id}`, undefined, {
              revalidate: false,
            });
          } catch (error) {
            console.error("[Chat] Failed to save final messages:", error);
          }
        }

        if (isMountedRef.current) {
          setIsLoading(false);
          const lastMessage =
            messagesRef.current[messagesRef.current.length - 1];
          if (lastMessage?.role === "assistant") {
            onFinish?.(lastMessage);
          }
        }
      } finally {
        isStreamingRef.current = false;
      }
    }, [id, mutate, mutateMessages, onFinish]),
    onError: useCallback(
      (error: Error) => {
        if (!isMountedRef.current) return;
        console.error("[Chat] Stream error:", error);
        setIsLoading(false);
        onError?.(error);
      },
      [onError]
    ),
  });

  const append = useCallback(
    async (message: CreateMessage) => {
      const newMessage: ChatMessage = {
        id: generateUUID(),
        parent_id: null,
        children_ids: [],
        timestamp: Date.now(),
        model: null,
        images: [],
        files: [],
        ...message,
      };

      console.log("[Chat] Appending new message:", {
        id: newMessage.id,
        role: newMessage.role,
        content: newMessage.content,
      });

      updateMessages((current) => [...current, newMessage]);
      return newMessage.id;
    },
    [updateMessages]
  );

  const reload = useCallback(async () => {
    if (messages.length === 0) return;
    if (!id) {
      console.error("Missing chat ID");
      onError?.(new Error("Missing chat ID"));
      return;
    }

    const lastUserMessageIndex = messages.findIndex((m) => m.role === "user");
    if (lastUserMessageIndex === -1) return;

    const messagesBeforeUser = messages.slice(0, lastUserMessageIndex + 1);
    setMessages(messagesBeforeUser);

    await startStream("/api/v1/chat/stream", {
      messages: messagesBeforeUser,
      ...config,
    });
  }, [messages, config, startStream, onError]);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const handleSubmit = useCallback(
    async (
      e?: React.FormEvent<HTMLFormElement>,
      chatRequestOptions?: ChatRequestOptions
    ) => {
      e?.preventDefault();

      if (!input.trim()) {
        return;
      }

      if (isLoading) {
        return;
      }

      console.log("[Chat] handleSubmit called with input:", input);

      try {
        // Create user message with proper typing
        const userMessage: CreateMessage = {
          role: "user",
          content: input,
        };

        // Clear input early to improve perceived performance
        setInput("");

        // Get current messages
        const currentMessages = messagesRef.current;
        console.log(
          "[Chat] Starting submission with messages:",
          currentMessages
        );

        // Set streaming state before starting stream
        isStreamingRef.current = true;
        setIsLoading(true);

        // Append user message and start streaming
        await append(userMessage);
        const messagesWithUser = messagesRef.current;

        // Format messages for API request
        const formattedMessages = messagesWithUser.map((msg) => ({
          role: msg.role,
          content: msg.content,
          metadata: {
            id: msg.id,
            parent_id: msg.parent_id,
            children_ids: msg.children_ids,
            timestamp: msg.timestamp,
            model: msg.model,
          },
          ...(msg.role === "user" && msg.images?.length
            ? { images: msg.images }
            : {}),
          ...(msg.role === "assistant" && msg.tool_calls
            ? { tool_calls: msg.tool_calls }
            : {}),
          ...(msg.role === "tool"
            ? { name: msg.name, tool_call_id: msg.metadata?.tool_call_id }
            : {}),
        }));

        console.log(
          "[Chat] Starting stream with formatted messages:",
          formattedMessages
        );

        await startStream("/api/v1/chat/stream", {
          messages: formattedMessages,
          ...config,
          ...chatRequestOptions,
        });
      } catch (error) {
        console.error("[Chat] Error in handleSubmit:", error);
        setIsLoading(false);
        isStreamingRef.current = false;
        if (onError) onError(error as Error);
      }
    },
    [input, isLoading, append, config, startStream, onError]
  );

  return {
    messages,
    setMessages,
    append,
    reload,
    stop,
    input,
    setInput,
    handleSubmit,
    isLoading,
  };
}
