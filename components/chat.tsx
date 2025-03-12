"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSWRConfig } from "swr";
import type { Message, Attachment } from "ai";
import { useAIChat, type ExtendedRequestOptions } from "@/hooks/use-ai-chat";

import { ChatHeader } from "@/components/chat-header";
import { Block } from "./block";
import { MultimodalInput } from "./multimodal-input";
import { Messages } from "./messages";
import { useBlockSelector } from "@/hooks/use-block";
import { saveChatMessages } from "@/lib/utils";
import { toast } from "sonner";
import { useChatContext } from "@/lib/chat/chat-context";

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

  const chatId = useMemo(() => id, [id]);

  // Store original chat ID in sessionStorage for test compatibility (is this needed?)
  useEffect(() => {
    if (typeof window !== "undefined" && chatId) {
      sessionStorage.setItem("originalChatId", chatId);
    }
  }, [chatId]);

  const {
    messages,
    activeMessages,
    setMessages,
    handleSubmit,
    input,
    setInput,
    append,
    isLoading,
    stop,
    reload,
    error,
    switchBranch,
    retryMessage,
    continue: continueMessage,
    currentId,
    getBranchInfo,
  } = useAIChat({
    id: chatId,
    initialMessages,
    api: "/api/chat/proxy",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      id: chatId,
      model: selectedModelId,
      stream: true,
      streamProtocol: "text",
      reasoning: {
        effort: "high",
        exclude: false,
      },
    },
    sendExtraMessageFields: true,
    experimental_throttle: 50,
    streamProtocol: "text",
    onUserMessageProcessed: async (processedMessage, currentMessages) => {
      try {
        // Save the messages to the database with proper parent-child relationships
        console.log(
          "[DEBUG] Saving processed user message with parent_id:",
          processedMessage.parent_id
        );

        const res = await saveChatMessages(chatId, currentMessages, currentId);
        if (!res.ok) {
          throw new Error(
            `Failed to save chat messages: ${res.status} ${res.statusText}`
          );
        }

        console.log(
          `Successfully saved ${currentMessages.length} messages to database with proper parent_id`
        );
        notifyChatUpdated(chatId);
      } catch (error) {
        console.error("Error saving user message:", error);
        // Don't show a toast here as it might confuse the user since the UI is updated
      }
    },
    onResponse: async (response) => {
      if (!response.ok) {
        toast.error(`API Error: ${response.statusText}`);
        return;
      }
    },
    onFinish: (message) => {
      // Prepare all messages for storage
      const messagesForStorage = [...messages, message];

      console.log("messagesForStorage", messagesForStorage);

      saveChatMessages(chatId, messagesForStorage, currentId)
        .then((res) => {
          if (!res.ok) {
            throw new Error(
              `Failed to save chat messages: ${res.status} ${res.statusText}`
            );
          }
          return res.json();
        })
        .then(() => {
          notifyChatUpdated(chatId);
        })
        .catch((error) => {
          console.error("Error saving chat history:", error);
          toast.error(
            "Failed to save chat history. Will retry on next response."
          );
        });

      mutate("/api/history");
      mutate("/api/chat");
    },
    onError: (error) => {
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

  const handleChatSubmit = async (
    e?: React.FormEvent,
    chatRequestOptions?: ExtendedRequestOptions
  ) => {
    try {
      // Call handleSubmit from useAIChat which will create the user message with proper parent_id
      // and trigger the onUserMessageProcessed callback for database operations
      handleSubmit(e, chatRequestOptions);

      // Scroll to the latest message after a short delay to ensure the UI has updated
      setTimeout(() => {
        if (scrollToMessageRef.current && messages.length > 0) {
          const latestMessage = messages[messages.length - 1];
          scrollToMessageRef.current(latestMessage.id);
        }
      }, 300);

      return;
    } catch (err) {
      const error = err as Error;
      setErrorState(error.message);
      toast.error(error.message);
    }
  };

  // Move this useEffect before the conditional return
  useEffect(() => {
    console.log("[chat] currentId is currently set to", currentId);

    if (currentId) {
      scrollToMessageRef.current?.(currentId);
    }
  }, [currentId]);

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
              messages={activeMessages}
              isLoading={isLoading}
              isBlockVisible={isBlockVisible}
              chatId={chatId}
              setMessages={setMessages}
              reload={reload}
              retryMessage={retryMessage}
              continue={continueMessage}
              scrollToMessage={(scrollFn) => {
                scrollToMessageRef.current = scrollFn;
              }}
              getBranchInfo={getBranchInfo}
              switchBranch={switchBranch}
              currentId={currentId ?? ""}
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
