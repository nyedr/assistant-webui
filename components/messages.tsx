import { PreviewMessage, ThinkingMessage } from "./message";
import { useScrollToBottom } from "./use-scroll-to-bottom";
import { memo, useRef, useEffect } from "react";
import { Message } from "ai";
import { cn } from "@/lib/utils";

interface MessagesProps {
  messages: Message[];
  isLoading: boolean;
  isBlockVisible: boolean;
  chatId: string;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload: (chatRequestOptions?: any) => Promise<string | null | undefined>;
  retryMessage?: (messageId: string) => Promise<string | null | undefined>;
  scrollToMessage?: (scrollFn: (messageId: string) => void) => void;
}

function MessagesComponent({
  messages,
  isLoading,
  isBlockVisible,
  chatId,
  setMessages,
  reload,
  retryMessage,
  scrollToMessage,
}: MessagesProps) {
  // Track the previous message count to determine if new messages were added
  const prevMessageCountRef = useRef(messages.length);
  const [containerRef, endRef, scrollToMessageFn] =
    useScrollToBottom<HTMLDivElement>();

  // Make scrollToMessage available to the parent
  useEffect(() => {
    if (scrollToMessage && scrollToMessageFn) {
      scrollToMessage(scrollToMessageFn);
    }
  }, [scrollToMessageFn, scrollToMessage]);

  // Auto-scroll when new messages are added
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

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative m-auto max-w-screen-lg pt-4 flex flex-col gap-5",
        isBlockVisible && "blur-md"
      )}
    >
      {messages.map((message) => (
        <PreviewMessage
          key={message.id}
          chatId={chatId}
          message={message}
          isLoading={isLoading}
          setMessages={setMessages}
          reload={reload}
          retryMessage={retryMessage}
          scrollToMessage={scrollToMessageFn}
        />
      ))}
      {isLoading && <ThinkingMessage />}
      <div ref={endRef} className="h-4" />
    </div>
  );
}

export const Messages = memo(MessagesComponent, (prevProps, nextProps) => {
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  if (prevProps.isBlockVisible !== nextProps.isBlockVisible) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;

  // Check if any message content has changed
  const hasContentChanged = prevProps.messages.some((prevMsg, index) => {
    if (index >= nextProps.messages.length) return true;
    const nextMsg = nextProps.messages[index];
    return prevMsg.content !== nextMsg.content;
  });

  return !hasContentChanged;
});
