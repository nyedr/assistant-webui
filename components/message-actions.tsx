"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { memo, useCallback } from "react";
import { Message } from "ai";
import CopyButton from "./ui/copy-button";
import DeleteButton from "./ui/delete-button";
import RetryButton from "./ui/retry-button";
import ContinueButton from "./ui/continue-button";
import { ExtendedMessage } from "@/lib/utils";
import { BranchInfo } from "@/lib/messages/branching";
import { toast } from "sonner";
import BranchNavigation from "./branch-navigation";

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  onMessageDelete,
  setMessages,
  retryMessage,
  continue: continueMessage,
  scrollToMessage,
  branchInfo,
  switchBranch,
}: {
  chatId: string;
  message: ExtendedMessage;
  isLoading: boolean;
  onMessageDelete?: () => void;
  setMessages?: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  retryMessage: (messageId: string) => Promise<string | null | undefined>;
  continue: (messageId: string) => Promise<string | null | undefined>;
  scrollToMessage?: (messageId: string) => void;
  branchInfo?: BranchInfo;
  switchBranch: (parentMessageId: string, branchIndex: number) => void;
}) {
  // Move all hooks before any conditional returns
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

  const handleRetry = useCallback(async () => {
    return retryMessage(message.id);
  }, [message.id, retryMessage]);

  const handleContinue = useCallback(async () => {
    try {
      await continueMessage(message.id);
    } catch (error) {
      console.error("Error continuing message:", error);
      // You could add toast notification here if desired

      toast.error("Error continuing message:", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [message.id, continueMessage]);

  // Now we can have conditional returns
  if (isLoading) return null;
  if (message.role === "user") return null;

  return (
    <div className="flex flex-row gap-1 items-center">
      {branchInfo && branchInfo.totalBranches > 1 && message.parent_id && (
        <BranchNavigation
          parent_id={message.parent_id}
          message_id={message.id}
          scrollToMessage={scrollToMessage}
          branchInfo={branchInfo}
          switchBranch={switchBranch}
        />
      )}

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
          <RetryButton
            onRetry={handleRetry}
            asChild={false}
            messageId={message.id}
            chatId={chatId}
            model={(message as ExtendedMessage).model}
          />
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
