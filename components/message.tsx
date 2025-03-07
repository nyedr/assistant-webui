"use client";

import type { Message } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useState, useEffect, useRef } from "react";

import { PencilEditIcon } from "./icons";
import ChatMarkdown from "./markdown";
import { MessageActions } from "./message-actions";
import { PreviewAttachment } from "./preview-attachment";
import { cn, ensureExtendedMessage } from "@/lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
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
  scrollToMessage,
  getBranchInfo,
  switchBranch,
}: PreviewMessageProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const isMountedRef = useRef(true);
  const isUserMessage = message.role === "user";

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
              <div className="flex flex-row gap-2 items-start w-full group-data-[role=user]/message:justify-end">
                {isUserMessage && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
                        onClick={() => {
                          setIsEditing(true);
                        }}
                      >
                        <PencilEditIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit message</TooltipContent>
                  </Tooltip>
                )}

                {isUserMessage ? (
                  <div className="user-message" data-message-role="user">
                    <ChatMarkdown
                      content={message.content}
                      isUserMessage={isUserMessage}
                    />
                  </div>
                ) : (
                  <div
                    className="assistant-message prose prose-sm dark:prose-invert max-w-none markdown-message-container"
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
              setMessages={setMessages}
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
