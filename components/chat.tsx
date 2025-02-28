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
import { useChatContext } from "@/lib/context/chat-context";

interface ChatProps {
  id: string;
  initialMessages: Message[];
  selectedModelId: string;
}

export function Chat({ id, initialMessages, selectedModelId }: ChatProps) {
  const { mutate } = useSWRConfig();
  const { notifyChatUpdated } = useChatContext();
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
    experimental_throttle: 50,
    streamProtocol: "data",
    generateId: generateUUID,
    onResponse: async (response) => {
      if (!response.ok) {
        toast.error(`API Error: ${response.statusText}`);
        return;
      }
    },
    onFinish: (message) => {
      // Get all current messages including the final response
      const currentMessages = [...messages];

      // Add the final message if it's not already in the messages array
      if (!currentMessages.some((m) => m.id === message.id)) {
        currentMessages.push({
          ...message,
          parts: message.parts || [],
        });
      }

      // Save all messages to the database
      fetch(`/api/chat/messages?id=${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentMessages),
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(
              `Failed to save chat messages: ${res.status} ${res.statusText}`
            );
          }
          return res.json();
        })
        .then(() => {
          // Notify about the chat update using our context
          notifyChatUpdated(chatId);
        })
        .catch((error) => {
          console.error("Error saving chat history:", error);
          toast.error(
            "Failed to save chat history. Will retry on next response."
          );
        });

      // Update the UI - make sure to update both endpoints used in the app
      mutate("/api/history");
      mutate("/api/chat"); // Add this to update sidebar
    },
    onError: (error) => {
      console.error("Chat error:", error);

      if (error.message?.includes("Failed to parse stream")) {
        toast.error(
          "Error processing the response stream. Trying to recover..."
        );
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

      setErrorState(null);

      // Submit the message with any attachments
      handleSubmit(e, {
        ...(options || {}),
        experimental_attachments: attachments,
      });

      // Scroll to the message after sending
      setTimeout(() => {
        if (scrollToMessageRef.current && messages.length > 0) {
          // Find the latest message ID to scroll to
          const latestMessage = messages[messages.length - 1];
          scrollToMessageRef.current(latestMessage.id);
        }
      }, 300);
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
