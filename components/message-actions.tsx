"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { memo, useCallback } from "react";
import { Message, ChatRequestOptions } from "ai";
import CopyButton from "./ui/copy-button";
import DeleteButton from "./ui/delete-button";
import RetryButton from "./ui/retry-button";
import ContinueButton from "./ui/continue-button";

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  onMessageDelete,
  setMessages,
  reload,
  scrollToMessage,
}: {
  chatId: string;
  message: Message;
  isLoading: boolean;
  onMessageDelete?: () => void;
  setMessages?: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload?: (
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  scrollToMessage?: (messageId: string) => void;
}) {
  if (isLoading) return null;
  if (message.role === "user") return null;

  const handleDelete = useCallback(() => {
    // If we have a setMessages function, update the UI immediately
    if (setMessages) {
      setMessages((currentMessages: Message[]) => {
        // Remove only the current message
        return currentMessages.filter((msg) => msg.id !== message.id);
      });
    }

    // Call the optional onMessageDelete callback
    if (onMessageDelete) {
      onMessageDelete();
    }
  }, [message.id, setMessages, onMessageDelete]);

  const handleRetry = useCallback(async (): Promise<
    string | null | undefined
  > => {
    if (!reload) return null;

    // Find the last user message before this assistant message
    if (setMessages) {
      setMessages((currentMessages) => {
        const messageIndex = currentMessages.findIndex(
          (msg) => msg.id === message.id
        );
        if (messageIndex === -1) return currentMessages;

        // Find the last user message before this assistant message
        let lastUserMessageIndex = -1;
        for (let i = messageIndex - 1; i >= 0; i--) {
          if (currentMessages[i].role === "user") {
            lastUserMessageIndex = i;
            break;
          }
        }

        if (lastUserMessageIndex === -1) {
          // If no user message found, just keep all messages up to this one
          return currentMessages.slice(0, messageIndex);
        }

        // Keep all messages up to and including the last user message
        const updatedMessages = currentMessages.slice(
          0,
          lastUserMessageIndex + 1
        );

        return updatedMessages;
      });

      // Execute the reload with the preserved context
      return reload();
    }

    // If we can't modify messages, just try to reload
    return reload();
  }, [message.id, setMessages, reload]);

  const handleContinue = useCallback(() => {
    // Handle the continue action
    console.log(`Continuing from message ${message.id}`);
    // You would implement the continuation logic here
  }, [message.id]);

  return (
    <div className="flex flex-row gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <CopyButton content={message.content} asChild={false} />
        </TooltipTrigger>
        <TooltipContent align="center" side="bottom">
          Copy
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <RetryButton onRetry={handleRetry} asChild={false} />
        </TooltipTrigger>
        <TooltipContent align="center" side="bottom">
          Retry
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <ContinueButton
            continue={handleContinue}
            chatId={chatId}
            messageId={message.id}
            scrollToMessage={scrollToMessage}
            asChild={false}
          />
        </TooltipTrigger>
        <TooltipContent align="center" side="bottom">
          Continue
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <DeleteButton
            chatId={chatId}
            messageId={message.id}
            onDelete={handleDelete}
            asChild={false}
          />
        </TooltipTrigger>
        <TooltipContent align="center" side="bottom">
          Delete
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;

    return true;
  }
);
