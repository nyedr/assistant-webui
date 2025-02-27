"use client";

import { useState, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { Message, Attachment } from "ai";
import { useChat } from "ai/react";

import { ChatHeader } from "@/components/chat-header";
import { Block } from "./block";
import { MultimodalInput } from "./multimodal-input";
import { Messages } from "./messages";
import { useBlockSelector } from "@/hooks/use-block";
import { generateUUID } from "@/lib/utils";
import { toast } from "sonner";

interface ChatProps {
  id: string;
  initialMessages: Message[];
  selectedModelId: string;
}

export function Chat({ id, initialMessages, selectedModelId }: ChatProps) {
  const { mutate } = useSWRConfig();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isBlockVisible = useBlockSelector((state) => state.isVisible);
  const [errorState, setErrorState] = useState<string | null>(null);
  const scrollToMessageRef = useRef<((messageId: string) => void) | null>(null);

  // Store consistent chat ID in state to avoid issues with prop changes
  const [chatId] = useState(id);

  // Log when the component mounts with a chat ID
  useEffect(() => {
    // Store the original chat ID in sessionStorage for debugging
    sessionStorage.setItem("originalChatId", chatId);
    return () => {
      // Clean up
    };
  }, [chatId]);

  const {
    messages,
    setMessages,
    handleSubmit,
    input,
    setInput,
    append,
    isLoading,
    stop,
    reload,
    error,
  } = useChat({
    id: chatId,
    initialMessages,
    api: `/api/chat/proxy`,
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      id: chatId,
      model: selectedModelId,
      stream: true,
      streamProtocol: "data",
      reasoning: {
        effort: "high",
        exclude: false,
      },
    },
    sendExtraMessageFields: true,
    experimental_throttle: 50, // Reduced throttle for more responsive updates
    streamProtocol: "data", // Client protocol setting - changed from "text" to "data"
    generateId: generateUUID,
    onResponse: async (response) => {
      // Handle API response
      if (!response.ok) {
        toast.error(`API Error: ${response.statusText}`);
        return;
      }

      // Log response status if not 200
      if (response.status !== 200) {
        console.log(
          "Non-200 response from proxy:",
          response.status,
          response.statusText
        );
      }

      // Log warning if content type is not as expected
      if (response.headers.get("content-type") !== "text/event-stream") {
        console.warn(
          "Warning: Expected 'text/event-stream' content type but received:",
          response.headers.get("content-type")
        );
      }
    },
    onFinish: (message) => {
      // Update chat history in the database
      // Get the most up-to-date messages from the vercel/ai useChat hook
      const currentMessages = messages;

      // IMPORTANT: Extract message IDs from the DOM to ensure we catch all visible messages
      // This handles the edge case where a message is rendered but not in the React state yet
      let visibleMessageIds: string[] = [];
      try {
        const messageElements = document.querySelectorAll("[data-message-id]");
        visibleMessageIds = Array.from(messageElements)
          .map((el) => el.getAttribute("data-message-id"))
          .filter(Boolean) as string[];
      } catch (e) {
        console.error("Error checking DOM for messages:", e);
      }

      // Check for any potential gaps in the conversation flow
      const assistantMessages = currentMessages.filter(
        (m) => m.role === "assistant"
      );
      const userMessages = currentMessages.filter((m) => m.role === "user");

      // Make sure to include the final message in what we save
      const allMessages = [...currentMessages];

      // Check if the final message is already in the array
      const messageExists = allMessages.some((m) => m.id === message.id);
      if (!messageExists) {
        allMessages.push({
          ...message,
          parts: message.parts || [],
        });
      }

      // IMPORTANT: Check sessionStorage for any cached messages we might need to include
      try {
        const cachedMsgKey = `temp_messages_${chatId}`;
        const cachedMsgsJson = sessionStorage.getItem(cachedMsgKey);
        if (cachedMsgsJson) {
          const cachedMsgs = JSON.parse(cachedMsgsJson);
          if (Array.isArray(cachedMsgs) && cachedMsgs.length > 0) {
            // Add any cached messages that aren't already in our allMessages array
            const existingIds = new Set(allMessages.map((m) => m.id));
            const missingMessages = cachedMsgs.filter(
              (m) => !existingIds.has(m.id)
            );

            if (missingMessages.length > 0) {
              allMessages.push(...missingMessages);

              // Sort messages by timestamp to maintain proper order
              allMessages.sort((a, b) => {
                const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return aTime - bTime;
              });
            }

            // Clear the cache after using it
            sessionStorage.removeItem(cachedMsgKey);
          }
        }
      } catch (e) {
        console.error("Error processing cached messages:", e);
      }

      // Sanitize message content to remove any SSE formatting and ensure proper spacing
      const sanitizedMessages = allMessages.map((msg) => {
        // Process assistant messages with minimal cleanup
        if (msg.role === "assistant") {
          // Only remove SSE formatting and fix any broken markdown - preserve original structure
          const content = msg.content;

          return {
            ...msg,
            content,
          };
        }

        return {
          ...msg,
          content: msg.content,
        };
      });

      // Store debug info in sessionStorage
      try {
        const debugInfo = {
          savedAt: new Date().toISOString(),
          messageCount: sanitizedMessages.length,
          messageIds: sanitizedMessages.map((m) => m.id),
          messageRoles: sanitizedMessages.map((m) => m.role),
          chatId: chatId,
          userMessages: sanitizedMessages.filter((m) => m.role === "user")
            .length,
          assistantMessages: sanitizedMessages.filter(
            (m) => m.role === "assistant"
          ).length,
        };
        sessionStorage.setItem(
          `chatDebug_${chatId}`,
          JSON.stringify(debugInfo)
        );
      } catch (e) {
        // Silent error - just debug info
      }

      // Save all messages using the dedicated messages endpoint
      const updatePromise = fetch(`/api/chat/messages?id=${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitizedMessages),
      })
        .then((res) => {
          if (!res.ok) {
            console.error(
              `Failed to save chat messages: ${res.status} ${res.statusText}`
            );
            return res.json().then((data) => {
              const errorMessage = data.error || "Failed to save chat messages";
              console.error(`Error details:`, data);
              throw new Error(errorMessage);
            });
          }
          return res.json();
        })
        .then((data) => {
          // Verify the saved messages to ensure all messages were captured
          if (data.data && data.data.chat) {
            try {
              const savedChat = JSON.parse(data.data.chat);
              const savedUserMsgCount = savedChat.messages.filter(
                (m: any) => m.role === "user"
              ).length;
              const savedAssistantMsgCount = savedChat.messages.filter(
                (m: any) => m.role === "assistant"
              ).length;

              // Check if we've lost any user messages
              const uiUserMsgCount = sanitizedMessages.filter(
                (m) => m.role === "user"
              ).length;
              if (savedUserMsgCount < uiUserMsgCount) {
                console.warn(
                  `Warning: Some user messages may not have been saved. UI: ${uiUserMsgCount}, Saved: ${savedUserMsgCount}`
                );
              }
            } catch (e) {
              console.error("Error parsing saved chat JSON:", e);
            }
          }
          return data;
        })
        .catch((error) => {
          console.error("Error saving chat history:", error);
          toast.error(
            "Failed to save chat history. Will retry on next response."
          );
        });

      // Notify UI components about the update
      mutate("/api/history");
    },
    onError: (error) => {
      console.error("Chat error:", error);

      // More detailed error handling based on error type
      if (error.message?.includes("Failed to parse stream")) {
        console.error(
          "Stream parsing error. This is likely an issue with the SSE format from the API."
        );

        toast.error(
          "Error processing the response stream. Trying to recover..."
        );

        // Attempt to recover by stopping the current stream
        stop();
      } else if (error.message?.includes("fetch failed")) {
        toast.error("Connection error. Please check your internet connection.");
      } else {
        toast.error(error.message || "An error occurred during chat");
      }

      setErrorState(error.message);
    },
  });

  // Monitor messages state for critical issues only
  useEffect(() => {
    // Only check for duplicate message IDs which could cause issues
    if (messages.length > 0) {
      const messageIds = messages.map((m) => m.id);
      const uniqueIds = new Set(messageIds);
      if (messageIds.length !== uniqueIds.size) {
        console.warn(`Warning: Duplicate message IDs detected in state`);
      }
    }
  }, [messages]);

  // Type-safe submit handler
  const handleChatSubmit = async (
    e?: React.FormEvent,
    options?: Record<string, unknown>
  ) => {
    try {
      if (!chatId) {
        throw new Error("Missing chat ID");
      }

      // Clear any previous errors
      setErrorState(null);

      // Use the standard handleSubmit which will ensure all system hooks fire correctly
      handleSubmit(e, {
        ...(options || {}),
        experimental_attachments: attachments,
      });

      // After the handleSubmit completes, find the most recent user message
      const recentUserMessageIndex = [...messages]
        .reverse()
        .findIndex((msg) => msg.role === "user");

      if (recentUserMessageIndex !== -1 && scrollToMessageRef.current) {
        const recentUserMessage = [...messages].reverse()[
          recentUserMessageIndex
        ];

        // Small delay to ensure DOM is updated
        setTimeout(() => {
          if (scrollToMessageRef.current && recentUserMessage.id) {
            scrollToMessageRef.current(recentUserMessage.id);
          }
        }, 300); // Increased timeout to ensure message is rendered
      }
    } catch (err) {
      const error = err as Error;
      setErrorState(error.message);
      toast.error(error.message);
    }
  };

  // Function to handle scrolling to a specific message
  const handleScrollToMessage = (messageId: string) => {
    if (scrollToMessageRef.current) {
      scrollToMessageRef.current(messageId);
    }
  };

  if (error || errorState) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">
          Error: {error?.message || errorState || "Unknown error occurred"}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex relative flex-col min-w-0 h-dvh bg-background">
        <ChatHeader selectedModelId={selectedModelId} />

        {messages.length > 0 ? (
          <div className="flex-1 overflow-y-auto md:px-5 px-2">
            <Messages
              chatId={chatId}
              isLoading={isLoading}
              messages={messages}
              setMessages={setMessages}
              reload={reload}
              isBlockVisible={isBlockVisible}
              scrollToMessage={(fn) => {
                if (typeof fn === "function") {
                  scrollToMessageRef.current = fn;
                }
              }}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center mb-28">
            <div className="text-primary-foreground font-[600] text-3xl mb-8">
              What can I help with?
            </div>
            <MultimodalInput
              chatId={chatId}
              input={input}
              setInput={setInput}
              handleSubmit={handleChatSubmit}
              isLoading={isLoading}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              append={append}
            />
          </div>
        )}

        {messages.length > 0 && (
          <div className="sticky bottom-0 left-0 right-0 bg-transparent mb-2 md:mb-8">
            <MultimodalInput
              chatId={chatId}
              input={input}
              setInput={setInput}
              handleSubmit={handleChatSubmit}
              isLoading={isLoading}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              append={append}
            />
          </div>
        )}
      </div>

      <Block
        chatId={chatId}
        input={input}
        setInput={setInput}
        handleSubmit={handleChatSubmit}
        isLoading={isLoading}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        append={append}
        messages={messages}
        setMessages={setMessages}
        reload={reload}
      />
    </>
  );
}
