"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSWRConfig } from "swr";
import type { Message, Attachment } from "ai";
import {
  useAIChat,
  type ChatRequestOptions,
  type ExtendedRequestOptions,
} from "@/hooks/use-ai-chat";

import { ChatHeader } from "@/components/chat-header";
import { Block } from "./block";
import { MultimodalInput } from "./multimodal-input";
import { Messages } from "./messages";
import { useBlockSelector } from "@/hooks/use-block";
import { generateUUID, saveChatMessages, ExtendedMessage } from "@/lib/utils";
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
    getBranchInfo,
    retryMessage,
    continue: continueMessage,
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
    onResponse: async (response) => {
      if (!response.ok) {
        toast.error(`API Error: ${response.statusText}`);
        return;
      }
    },
    onFinish: (message) => {
      // Save the complete chat to the database

      // Prepare all messages for storage
      const messagesForStorage = [
        ...messages,
        message as unknown as ExtendedMessage,
      ].map((msg) => {
        const extMsg = msg as ExtendedMessage;
        return {
          ...extMsg,
          model:
            extMsg.role === "assistant"
              ? extMsg.model || selectedModelId || "unknown"
              : extMsg.model,
        } as Message;
      });

      console.log("messagesForStorage", messagesForStorage);

      // Save to DB
      saveChatMessages(chatId, messagesForStorage as Message[])
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

  // Filter messages to only show those in the current branch path
  const filteredMessages = useMemo(() => {
    // If no messages or no branch state, just return all messages
    if (!messages.length) return messages;

    // Create a map of message IDs to their messages for quick lookup
    const messageMap = new Map(messages.map((msg) => [msg.id, msg]));

    // Find the last message in the current branch
    const lastMessage = messages[messages.length - 1];

    // We'll build a chain from the last message up to the root
    const messageChain = new Set<string>();
    let currentId: string | null | undefined = lastMessage.id;

    // Traverse up the parent chain to collect all messages in this branch
    while (currentId) {
      messageChain.add(currentId);
      const currentMsg = messageMap.get(currentId);
      currentId = currentMsg?.parent_id;
    }

    // Filter messages to only include those in the current branch path
    return messages.filter((msg) => messageChain.has(msg.id));
  }, [messages]);

  // Type-safe submit handler
  const handleChatSubmit = async (
    e?: React.FormEvent,
    options?: Record<string, any>
  ) => {
    try {
      if (!chatId) {
        throw new Error("Missing chat ID");
      }

      setErrorState(null);

      // When a new user message is about to be sent
      if (input.trim() && !options?.preserveMessageId) {
        // Generate a consistent ID for the user message
        const messageId = generateUUID();

        // Store a copy of the input
        const userContent = input;

        // Clear input immediately for better UX
        setInput("");

        // Note: We don't need to find the parent ID manually anymore
        // as useAIChat will handle this automatically
        await append(
          {
            id: messageId,
            role: "user",
            content: userContent,
          } as Message,
          {
            ...(options || {}),
            experimental_attachments: attachments,
          } as ChatRequestOptions
        );

        // Scroll to the message after sending
        setTimeout(() => {
          if (scrollToMessageRef.current && messages.length > 0) {
            const latestMessage = messages[messages.length - 1];
            scrollToMessageRef.current(latestMessage.id);
          }
        }, 300);
        return;
      }

      // For other cases like regeneration, use normal handleSubmit
      handleSubmit(e, {
        ...(options || {}),
        experimental_attachments: attachments,
      } as ExtendedRequestOptions);

      // Scroll to the message after sending
      setTimeout(() => {
        if (scrollToMessageRef.current && messages.length > 0) {
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

        {filteredMessages.length > 0 ? (
          <div className="flex-1 overflow-y-auto md:px-5 px-2">
            <Messages
              messages={filteredMessages}
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
