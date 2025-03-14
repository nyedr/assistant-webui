"use client";

import type { Message } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useState, useEffect, useRef, useCallback } from "react";

import ChatMarkdown from "./markdown";
import { MessageActions } from "./message-actions";
import { PreviewAttachment } from "./preview-attachment";
import { cn, ensureExtendedMessage } from "@/lib/utils";
import { MessageEditor } from "./message-editor";
import AnimatedGradientText from "./ui/gradient-text";
import { ExtendedRequestOptions } from "@/hooks/use-ai-chat";

interface PreviewMessageProps {
  chatId: string;
  message: Message;
  isLoading: boolean;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload: (
    chatRequestOptions?: ExtendedRequestOptions
  ) => Promise<string | null | undefined>;
  retryMessage?: (messageId: string) => Promise<string | null | undefined>;
  continue?: (messageId: string) => Promise<string | null | undefined>;
  scrollToMessage?: (messageId: string) => void;
  getBranchInfo?: (parentMessageId: string) => {
    currentIndex: number;
    totalBranches: number;
  };
  switchBranch?: (parentMessageId: string, branchIndex: number) => void;
}

const PurePreviewMessage = ({
  chatId,
  message,
  isLoading,
  setMessages,
  reload,
  retryMessage,
  continue: continueMessage,
  scrollToMessage,
  getBranchInfo,
  switchBranch,
}: PreviewMessageProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const isMountedRef = useRef(true);
  const isUserMessage = message.role === "user";

  const deleteMessage = useCallback(() => {
    // TODO: Remove message form parent children_ids array
    setMessages((currentMessages: Message[]) => {
      return currentMessages?.filter((msg) => msg.id !== message.id) || [];
    });
  }, [message.id, setMessages]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      isMountedRef.current = false;
    }, 100);

    return () => {
      clearTimeout(timeout);
    };
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
        data-message-id={message.id}
      >
        <div
          className={cn(
            "flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
            {
              "w-full": isEditing,
              "group-data-[role=user]/message:w-fit": !isEditing,
            }
          )}
        >
          <div className="flex flex-col gap-3 w-full">
            {message.experimental_attachments && (
              <div className="flex flex-row justify-end gap-2">
                {message.experimental_attachments.map((attachment) => (
                  <PreviewAttachment
                    key={attachment.url}
                    attachment={attachment}
                  />
                ))}
              </div>
            )}

            {message.content && !isEditing && (
              <div className="flex flex-row gap-2 items-center w-full group-data-[role=user]/message:justify-end">
                {isUserMessage ? (
                  <div
                    className="rounded-3xl px-5 py-2.5 bg-muted text-primary-foreground"
                    data-message-role="user"
                  >
                    <ChatMarkdown
                      content={message.content}
                      isUserMessage={isUserMessage}
                    />
                  </div>
                ) : (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none markdown-message-container"
                    data-message-role="assistant"
                  >
                    <ChatMarkdown content={message.content} />
                  </div>
                )}
              </div>
            )}

            {message.content && isEditing && (
              <div className="flex flex-row gap-2 items-start">
                <div className="size-8" />

                <MessageEditor
                  key={message.id}
                  message={message}
                  setIsEditing={setIsEditing}
                  setMessages={setMessages}
                  reload={reload}
                />
              </div>
            )}

            <MessageActions
              key={`action-${message.id}`}
              chatId={chatId}
              message={ensureExtendedMessage(message)}
              isLoading={isLoading}
              setIsEditing={setIsEditing}
              deleteMessage={deleteMessage}
              getBranchInfo={getBranchInfo}
              switchBranch={switchBranch}
              reload={(options?: ExtendedRequestOptions) => {
                if (options) {
                  const { options: _, ...standardOptions } = options;
                  return reload(standardOptions);
                }
                return reload();
              }}
              retryMessage={retryMessage}
              continue={continueMessage}
              scrollToMessage={scrollToMessage}
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    // Always re-render if loading state changes
    if (prevProps.isLoading !== nextProps.isLoading) return false;

    // Always re-render if message content changes
    if (prevProps.message.content !== nextProps.message.content) {
      return false;
    }

    // Check for changes in all other props that would require a re-render
    if (prevProps.chatId !== nextProps.chatId) return false;
    if (prevProps.setMessages !== nextProps.setMessages) return false;
    if (prevProps.reload !== nextProps.reload) return false;
    if (prevProps.retryMessage !== nextProps.retryMessage) return false;
    if (prevProps.continue !== nextProps.continue) return false;
    if (prevProps.scrollToMessage !== nextProps.scrollToMessage) return false;
    if (prevProps.getBranchInfo !== nextProps.getBranchInfo) return false;
    if (prevProps.switchBranch !== nextProps.switchBranch) return false;

    // Comparing message objects more thoroughly
    if (
      JSON.stringify(prevProps.message) !== JSON.stringify(nextProps.message)
    ) {
      return false;
    }

    return true;
  }
);

export const ThinkingMessage = () => {
  return (
    <motion.div
      className="w-full mx-auto max-w-3xl px-4 group/message "
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 1 } }}
      data-role="assistant"
    >
      <AnimatedGradientText className="text-base" text="Thinking..." />
    </motion.div>
  );
};
