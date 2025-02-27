import { PreviewMessage, ThinkingMessage } from "./message";
import { useScrollToBottom } from "./use-scroll-to-bottom";
import { memo, useRef, useEffect, useMemo } from "react";
import { ChatRequestOptions, Message } from "ai";
import { cn } from "@/lib/utils";

interface MessagesProps {
  messages: Message[];
  isLoading: boolean;
  isBlockVisible: boolean;
  chatId: string;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload: (
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  scrollToMessage?: (scrollFn: (messageId: string) => void) => void;
}

function MessagesComponent({
  messages,
  isLoading,
  isBlockVisible,
  chatId,
  setMessages,
  reload,
  scrollToMessage,
}: MessagesProps) {
  // Track the previous message count to determine if new messages were added
  const prevMessageCountRef = useRef(messages.length);
  const latestContentRef = useRef<Record<string, string>>({});
  const [containerRef, endRef, scrollToMessageFn] =
    useScrollToBottom<HTMLDivElement>();

  // Make scrollToMessage available to the parent
  useEffect(() => {
    if (scrollToMessage && scrollToMessageFn) {
      scrollToMessage(scrollToMessageFn);
    }
  }, [scrollToMessageFn, scrollToMessage]);

  // Check if messages were actually added
  useEffect(() => {
    const currentMsgCount = messages.length;
    const previousMsgCount = prevMessageCountRef.current;

    prevMessageCountRef.current = currentMsgCount;

    // If we detect a real message was added (not just content updated)
    if (currentMsgCount > previousMsgCount && !isBlockVisible) {
      // Wait a bit for the DOM to update
      setTimeout(() => {
        if (endRef.current) {
          endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
        }
      }, 100);
    }
  }, [messages.length, isBlockVisible]);

  // Update ref with latest content
  useEffect(() => {
    messages.forEach((msg: Message) => {
      if (msg.content !== latestContentRef.current[msg.id]) {
        latestContentRef.current[msg.id] = msg.content;
      }
    });
  }, [messages]);

  // Sanitize message content to remove any SSE formatting
  const sanitizedMessages = messages.map((msg) => ({
    ...msg,
    content: msg.content,
  }));

  return useMemo(() => {
    return (
      <div
        ref={containerRef}
        className={cn(
          "relative m-auto max-w-screen-lg pt-4 flex flex-col gap-5",
          isBlockVisible && "blur-md"
        )}
      >
        {sanitizedMessages.map((message) => (
          <PreviewMessage
            key={message.id}
            chatId={chatId}
            message={message}
            isLoading={isLoading}
            setMessages={setMessages}
            reload={reload}
          />
        ))}
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
  if (hasContentChanged) return false;

  return true;
});
