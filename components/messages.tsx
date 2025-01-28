import { PreviewMessage, ThinkingMessage } from "./message";
import { useScrollToBottom } from "./use-scroll-to-bottom";
import { memo, useRef, useEffect, useMemo } from "react";
import { ChatMessage, UpdateMessages } from "@/hooks/use-chat";

interface MessagesProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isBlockVisible: boolean;
  chatId: string;
  setMessages: UpdateMessages;
  reload: () => Promise<void>;
}

function MessagesComponent({
  messages,
  isLoading,
  isBlockVisible,
  chatId,
  setMessages,
  reload,
}: MessagesProps) {
  const latestContentRef = useRef<Record<string, string>>({});
  const [containerRef, endRef] = useScrollToBottom<HTMLDivElement>();

  // Update ref with latest content
  useEffect(() => {
    messages.forEach((msg: ChatMessage) => {
      if (msg.content !== latestContentRef.current[msg.id]) {
        latestContentRef.current[msg.id] = msg.content;
      }
    });
  }, [messages]);

  return useMemo(() => {
    console.log("[Messages] PureMessages render with:", {
      messageCount: messages.length,
      messages,
      isLoading,
      isBlockVisible,
    });

    return (
      <div
        className="flex flex-col gap-4"
        // ref={containerRef}
      >
        {messages.map((message: ChatMessage) => {
          // Use latest content from ref if available
          const content =
            latestContentRef.current[message.id] || message.content;
          const messageWithLatestContent = {
            ...message,
            content,
          };

          console.log(
            "[Messages] Rendering message:",
            messageWithLatestContent
          );
          return (
            <PreviewMessage
              key={message.id}
              message={messageWithLatestContent}
              isLoading={
                isLoading && message.id === messages[messages.length - 1]?.id
              }
              chatId={chatId}
              setMessages={setMessages}
              reload={reload}
            />
          );
        })}
        {isLoading && <ThinkingMessage />}
        <div ref={endRef} className="h-4" />
      </div>
    );
  }, [messages, isLoading, isBlockVisible, chatId, setMessages, reload]);
}

export const Messages = memo(MessagesComponent, (prevProps, nextProps) => {
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  if (prevProps.isBlockVisible !== nextProps.isBlockVisible) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;

  // Check if any message content has changed
  const hasContentChanged = prevProps.messages.some((prevMsg, index) => {
    const nextMsg = nextProps.messages[index];
    return prevMsg.content !== nextMsg.content;
  });
  if (hasContentChanged) {
    console.log("[Messages] Re-rendering due to message content change");
    return false;
  }

  console.log("[Messages] Skipping re-render - no changes detected");
  return true;
});
