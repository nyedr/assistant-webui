"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { memo, useCallback, useState } from "react";
import { Message } from "ai";
import CopyButton from "./ui/copy-button";
import DeleteButton from "./ui/delete-button";
import RetryButton from "./ui/retry-button";
import ContinueButton from "./ui/continue-button";
import { ExtendedMessage } from "@/lib/utils";
import { ExtendedRequestOptions } from "@/hooks/use-ai-chat";

// // Add new component for branch navigation
// function BranchNavigation({
//   message,
//   currentBranchIndex,
//   setCurrentBranchIndex,
//   totalBranches,
// }: {
//   message: ExtendedMessage;
//   currentBranchIndex: number;
//   setCurrentBranchIndex: (index: number) => void;
//   totalBranches: number;
// }) {
//   if (!message.parent_id || !totalBranches || totalBranches <= 1) {
//     return null;
//   }

//   const handlePrevBranch = () => {
//     const newIndex = (currentBranchIndex - 1 + totalBranches) % totalBranches;
//     setCurrentBranchIndex(newIndex);
//   };

//   const handleNextBranch = () => {
//     const newIndex = (currentBranchIndex + 1) % totalBranches;
//     setCurrentBranchIndex(newIndex);
//   };

//   return (
//     <div className="flex items-center mr-2 text-xs text-muted-foreground">
//       <Tooltip>
//         <TooltipTrigger asChild>
//           <Button
//             variant="ghost"
//             size="icon"
//             className="h-6 w-6"
//             onClick={handlePrevBranch}
//             disabled={totalBranches <= 1}
//           >
//             <ChevronLeftIcon className="h-3 w-3" />
//           </Button>
//         </TooltipTrigger>
//         <TooltipContent side="bottom">Previous branch</TooltipContent>
//       </Tooltip>

//       <span className="mx-1 min-w-8 text-center">
//         {currentBranchIndex + 1}/{totalBranches}
//       </span>

//       <Tooltip>
//         <TooltipTrigger asChild>
//           <Button
//             variant="ghost"
//             size="icon"
//             className="h-6 w-6"
//             onClick={handleNextBranch}
//             disabled={totalBranches <= 1}
//           >
//             <ChevronRightIcon className="h-3 w-3" />
//           </Button>
//         </TooltipTrigger>
//         <TooltipContent side="bottom">Next branch</TooltipContent>
//       </Tooltip>
//     </div>
//   );
// }

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  onMessageDelete,
  setMessages,
  reload,
  retryMessage,
  scrollToMessage,
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
}) {
  // const [currentBranchIndex, setCurrentBranchIndex] = useState(0);
  // const [totalBranches, setTotalBranches] = useState(0);

  // // Determine if this message has multiple branches (siblings)
  // useEffect(() => {
  //   if (!message.parent_id || !setMessages) return;

  //   // Find how many siblings this message has
  //   setMessages((currentMessages) => {
  //     const parentMessage = currentMessages.find(
  //       (msg) => msg.id === message.parent_id
  //     ) as ExtendedMessage | undefined;

  //     if (parentMessage?.children_ids?.length) {
  //       setTotalBranches(parentMessage.children_ids.length);
  //       // Find the current message's index in the children array
  //       const currentIndex = parentMessage.children_ids.findIndex(
  //         (id) => id === message.id
  //       );
  //       if (currentIndex !== -1) {
  //         setCurrentBranchIndex(currentIndex);
  //       }
  //     }

  //     return currentMessages; // Don't modify the messages
  //   });
  // }, [message.id, message.parent_id, setMessages]);

  // When branch changes, update messages to show the selected branch
  // useEffect(() => {
  //   if (totalBranches <= 1 || !message.parent_id || !setMessages) return;

  //   setMessages((currentMessages) => {
  //     const parentMessage = currentMessages.find(
  //       (msg) => msg.id === message.parent_id
  //     ) as ExtendedMessage | undefined;

  //     if (!parentMessage?.children_ids?.length) return currentMessages;

  //     const targetBranchId = parentMessage.children_ids[currentBranchIndex];
  //     if (!targetBranchId) return currentMessages;

  //     // If we're already showing this branch, don't change anything
  //     if (targetBranchId === message.id) return currentMessages;

  //     // Find the current assistant message in the tree
  //     const assistantMessageIndex = currentMessages.findIndex(
  //       (msg) => msg.id === message.id
  //     );

  //     if (assistantMessageIndex === -1) return currentMessages;

  //     // Find the target branch message
  //     const targetMessage = currentMessages.find(
  //       (msg) => msg.id === targetBranchId
  //     );

  //     if (!targetMessage) return currentMessages;

  //     // Create new messages array with the selected branch message
  //     const newMessages = [...currentMessages];
  //     newMessages[assistantMessageIndex] = targetMessage;

  //     // Remove subsequent messages as we're switching branches
  //     return newMessages.slice(0, assistantMessageIndex + 1);
  //   });
  // }, [
  //   currentBranchIndex,
  //   totalBranches,
  //   message.id,
  //   message.parent_id,
  //   setMessages,
  // ]);

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
      {/* Branch navigation controls */}
      {/* {setMessages && (
        <BranchNavigation
          message={message}
          currentBranchIndex={currentBranchIndex}
          setCurrentBranchIndex={setCurrentBranchIndex}
          totalBranches={totalBranches}
        />
      )} */}

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
