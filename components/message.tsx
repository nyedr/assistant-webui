"use client";

import { ChatMessage, ChatRole } from "@/hooks/use-chat";
import cx from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useState, useEffect, useRef } from "react";

import { PencilEditIcon, SparklesIcon } from "./icons";
import ChatMarkdown from "./markdown";
import { MessageActions } from "./message-actions";
import { PreviewAttachment } from "./preview-attachment";
import equal from "fast-deep-equal";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { MessageEditor } from "./message-editor";

interface PreviewMessageProps {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  setMessages: (
    messages: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])
  ) => void;
  reload: () => Promise<void>;
}

const PurePreviewMessage = ({
  chatId,
  message,
  isLoading,
  setMessages,
  reload,
}: PreviewMessageProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const isMountedRef = useRef(true);
  const isAssistantMessage = message.role === "assistant";
  const isUserMessage = message.role === "user";

  console.log("[PreviewMessage] Rendering message:", {
    id: message.id,
    role: message.role,
    content: message.content,
    isAssistantMessage,
    isUserMessage,
  });

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
          {isAssistantMessage && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 w-full">
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
              <div className="flex flex-row gap-2 items-start max-w-[712px] group-data-[role=user]/message:justify-end">
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
                  <div className="user-message">
                    <ChatMarkdown content={message.content} />
                  </div>
                ) : (
                  <div className="flex flex-col">
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

            {message.tool_calls && (
              <div className="flex flex-col gap-4">
                {/* TODO: Handle tool calling UI */}
              </div>
            )}

            <MessageActions
              key={`action-${message.id}`}
              chatId={chatId}
              message={message}
              isLoading={isLoading}
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
      console.log("[PreviewMessage] Re-rendering due to content change:", {
        prevContent: prevProps.message.content,
        nextContent: nextProps.message.content,
      });
      return false;
    }

    // Always re-render if tool calls change
    if (!equal(prevProps.message.tool_calls, nextProps.message.tool_calls)) {
      console.log("[PreviewMessage] Re-rendering due to tool calls change");
      return false;
    }

    // Always re-render if message metadata changes
    if (!equal(prevProps.message.metadata, nextProps.message.metadata)) {
      console.log("[PreviewMessage] Re-rendering due to metadata change");
      return false;
    }

    console.log("[PreviewMessage] Skipping re-render - no changes detected");
    return true;
  }
);

export const ThinkingMessage = () => {
  const role: ChatRole = "assistant";

  return (
    <motion.div
      className="w-full mx-auto max-w-3xl px-4 group/message "
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 1 } }}
      data-role={role}
    >
      <div
        className={cx(
          "flex gap-4 group-data-[role=user]/message:px-3 w-full group-data-[role=user]/message:w-fit group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl group-data-[role=user]/message:py-2 rounded-xl",
          {
            "group-data-[role=user]/message:bg-muted": true,
          }
        )}
      >
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border">
          <SparklesIcon size={14} />
        </div>

        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 text-muted-foreground">
            Thinking...
          </div>
        </div>
      </div>
    </motion.div>
  );
};
