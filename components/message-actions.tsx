"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { memo, useCallback } from "react";
import { Message } from "ai";
import CopyButton from "./ui/copy-button";
import DeleteButton from "./ui/delete-button";
import RetryButton from "./ui/retry-button";
import ContinueButton from "./ui/continue-button";
import { ExtendedMessage } from "@/lib/utils";
import { ExtendedRequestOptions } from "@/hooks/use-ai-chat";
import { Button } from "./ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

// Add new component for branch navigation
function BranchNavigation({
  message,
  scrollToMessage,
  chatId,
  getBranchInfo,
  switchBranch,
}: {
  message: ExtendedMessage;
  scrollToMessage?: (messageId: string) => void;
  chatId: string;
  getBranchInfo: (parentMessageId: string) => {
    currentIndex: number;
    totalBranches: number;
  };
  switchBranch: (parentMessageId: string, branchIndex: number) => void;
}) {
  // Only show branch navigation if the message has a parent
  if (!message.parent_id) {
    return null;
  }

  const { currentIndex, totalBranches } = getBranchInfo(message.parent_id);

  // Only show if there are multiple branches
  if (totalBranches <= 1) {
    return null;
  }

  const handlePrevBranch = () => {
    const newIndex = (currentIndex - 1 + totalBranches) % totalBranches;
    switchBranch(message.parent_id!, newIndex);
    if (scrollToMessage) {
      scrollToMessage(message.id);
    }
  };

  const handleNextBranch = () => {
    const newIndex = (currentIndex + 1) % totalBranches;
    switchBranch(message.parent_id!, newIndex);
    if (scrollToMessage) {
      scrollToMessage(message.id);
    }
  };

  return (
    <div className="flex items-center mr-2 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handlePrevBranch}
        disabled={totalBranches <= 1}
      >
        <ChevronLeftIcon className="h-3 w-3" />
      </Button>

      <span className="mx-1 min-w-8 text-center">
        {currentIndex + 1}/{totalBranches}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleNextBranch}
        disabled={totalBranches <= 1}
      >
        <ChevronRightIcon className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  onMessageDelete,
  setMessages,
  reload,
  retryMessage,
  scrollToMessage,
  getBranchInfo,
  switchBranch,
}: {
  chatId: string;
  message: ExtendedMessage;
  isLoading: boolean;
  onMessageDelete?: () => void;
  setMessages?: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload?: (
    chatRequestOptions?: ExtendedRequestOptions
  ) => Promise<string | null | undefined>;
  retryMessage?: (messageId: string) => Promise<string | null | undefined>;
  scrollToMessage?: (messageId: string) => void;
  getBranchInfo?: (parentMessageId: string) => {
    currentIndex: number;
    totalBranches: number;
  };
  switchBranch?: (parentMessageId: string, branchIndex: number) => void;
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
    // If we have retryMessage from useAIChat, use that directly
    if (retryMessage) {
      return retryMessage(message.id);
    }

    // Fallback to older reload behavior if retryMessage is not available
    if (!reload) return null;

    return reload({
      options: {
        parentMessageId: (message as ExtendedMessage).parent_id || undefined,
      },
    });
  }, [message.id, retryMessage, reload]);

  const handleContinue = useCallback(() => {
    // Handle the continue action
    console.log(`Continuing from message ${message.id}`);
    // You would implement the continuation logic here
  }, [message.id]);

  return (
    <div className="flex flex-row gap-1 items-center">
      {/* Add BranchNavigation component if getBranchInfo and switchBranch are provided */}
      {getBranchInfo && switchBranch && message.parent_id && (
        <BranchNavigation
          message={message}
          scrollToMessage={scrollToMessage}
          chatId={chatId}
          getBranchInfo={getBranchInfo}
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
