import { ChevronLeftIcon, ChevronRightIcon } from "../icons";

import { ExtendedMessage } from "@/lib/utils";
import { Button } from "./button";

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

export default BranchNavigation;
