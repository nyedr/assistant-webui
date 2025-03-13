"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { memo, useCallback, Dispatch, SetStateAction } from "react";
import CopyButton from "./ui/copy-button";
import DeleteButton from "./ui/delete-button";
import RetryButton from "./ui/retry-button";
import ContinueButton from "./ui/continue-button";
import { cn, ExtendedMessage } from "@/lib/utils";
import { ExtendedRequestOptions } from "@/hooks/use-ai-chat";
import BranchNavigation from "./ui/branch-navigation";
import EditMessageButton from "./ui/edit-message-button";

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  deleteMessage,
  reload,
  retryMessage,
  continue: continueMessage,
  scrollToMessage,
  getBranchInfo,
  switchBranch,
  setIsEditing,
}: {
  chatId: string;
  message: ExtendedMessage;
  isLoading: boolean;
  deleteMessage: () => void;
  reload?: (
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
  setIsEditing: Dispatch<SetStateAction<boolean>>;
}) {
  if (isLoading) return null;

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

  const handleContinue = useCallback(async () => {
    if (continueMessage) {
      try {
        await continueMessage(message.id);
      } catch (error) {
        console.error("Error continuing message:", error);
        // You could add toast notification here if desired
      }
    } else {
      console.warn("Continue function not provided");
    }
  }, [message.id, continueMessage]);

  const isUserMessage = message.role === "user";

  return (
    <div
      className={cn("flex flex-row gap-1 items-center", {
        "justify-end": isUserMessage,
        "justify-start": !isUserMessage,
      })}
    >
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

      {!isUserMessage && (
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
      )}

      {!isUserMessage && (
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
      )}

      {isUserMessage && (
        <EditMessageButton
          content={message.content}
          asChild={false}
          setIsEditing={setIsEditing}
        />
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <DeleteButton
            chatId={chatId}
            messageId={message.id}
            onDelete={deleteMessage}
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

    // Check critical props that would require re-rendering
    if (prevProps.setIsEditing !== nextProps.setIsEditing) return false;
    if (prevProps.deleteMessage !== nextProps.deleteMessage) return false;
    if (prevProps.reload !== nextProps.reload) return false;
    if (prevProps.retryMessage !== nextProps.retryMessage) return false;
    if (prevProps.continue !== nextProps.continue) return false;
    if (prevProps.scrollToMessage !== nextProps.scrollToMessage) return false;
    if (prevProps.getBranchInfo !== nextProps.getBranchInfo) return false;
    if (prevProps.switchBranch !== nextProps.switchBranch) return false;
    if (prevProps.chatId !== nextProps.chatId) return false;

    // Message comparison (checking ID is usually sufficient for messages)
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;

    return true;
  }
);
