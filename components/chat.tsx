"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";

import { ChatHeader } from "@/components/chat-header";
import { ChatMessage, useChat, type Attachment } from "@/hooks/use-chat";

import { Block } from "./block";
import { MultimodalInput } from "./multimodal-input";
import { Messages } from "./messages";
import { useBlockSelector } from "@/hooks/use-block";

export function Chat({
  id,
  initialMessages,
  selectedModelId,
}: {
  id: string;
  initialMessages: Array<ChatMessage>;
  selectedModelId: string;
}) {
  const { mutate } = useSWRConfig();
  const [error, setError] = useState<string | null>(null);

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
  } = useChat({
    id,
    config: {
      model: selectedModelId,
      stream: true,
    },
    initialMessages,
    onFinish: async (message) => {
      if (message && message.role === "assistant") {
        await mutate("/api/chat", undefined, { revalidate: true });
      }
    },
    onError: (error) => {
      setError(error.message);
      console.error("Chat error:", error);
    },
  });

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isBlockVisible = useBlockSelector((state) => state.isVisible);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex relative flex-col min-w-0 h-dvh bg-background">
        <ChatHeader selectedModelId={selectedModelId} />

        {messages.length > 0 ? (
          <div className="flex-1 overflow-y-auto">
            <Messages
              chatId={id}
              isLoading={isLoading}
              messages={messages}
              setMessages={setMessages}
              reload={reload}
              isBlockVisible={isBlockVisible}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center mb-28">
            <div className="text-primary-foreground font-[600] text-3xl mb-8">
              What can I help with?
            </div>
            <div className="w-full max-w-3xl px-4">
              <form className="flex gap-2 w-full">
                <MultimodalInput
                  chatId={id}
                  input={input}
                  setInput={setInput}
                  handleSubmit={async (e) => {
                    if (!id) {
                      setError("Missing chat ID");
                      return;
                    }
                    await handleSubmit(e);
                  }}
                  isLoading={isLoading}
                  stop={stop}
                  attachments={attachments}
                  setAttachments={setAttachments}
                  messages={messages}
                  setMessages={setMessages}
                  append={async (...args) => {
                    if (!id) {
                      setError("Missing chat ID");
                      return null;
                    }
                    return append(...args);
                  }}
                />
              </form>
            </div>
          </div>
        )}

        {messages.length > 0 && (
          <div className="sticky bottom-0 left-0 right-0 bg-transparent">
            <form className="flex mx-auto px-4 py-4 md:py-6 gap-2 w-full max-w-3xl">
              <MultimodalInput
                chatId={id}
                input={input}
                setInput={setInput}
                handleSubmit={async (e) => {
                  if (!id) {
                    setError("Missing chat ID");
                    return;
                  }
                  await handleSubmit(e);
                }}
                isLoading={isLoading}
                stop={stop}
                attachments={attachments}
                setAttachments={setAttachments}
                messages={messages}
                setMessages={setMessages}
                append={async (...args) => {
                  if (!id) {
                    setError("Missing chat ID");
                    return null;
                  }
                  return append(...args);
                }}
              />
            </form>
          </div>
        )}
      </div>

      <Block
        chatId={id}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
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
