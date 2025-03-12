import { BranchInfo } from "@/lib/messages/branching";
import { ChevronRightIcon } from "./icons";

import { ChevronLeftIcon } from "./icons";

import { Button } from "./ui/button";

export default function BranchNavigation({
  parent_id,
  message_id,
  scrollToMessage,
  branchInfo,
  switchBranch,
}: {
  parent_id: string;
  message_id: string;
  scrollToMessage?: (messageId: string) => void;
  branchInfo: BranchInfo;
  switchBranch: (parentMessageId: string, branchIndex: number) => void;
}) {
  const { currentIndex, totalBranches } = branchInfo;

  console.log("[BranchNavigation] branchInfo", branchInfo);

  const handlePrevBranch = () => {
    const newIndex =
      currentIndex - 1 < 0 ? totalBranches - 1 : currentIndex - 1;
    if (!parent_id) return;
    switchBranch(parent_id, newIndex);
    if (scrollToMessage) {
      scrollToMessage(message_id);
    }
  };

  const handleNextBranch = () => {
    const newIndex = currentIndex + 1 >= totalBranches ? 0 : currentIndex + 1;
    if (!parent_id) return;
    switchBranch(parent_id, newIndex);
    if (scrollToMessage) {
      scrollToMessage(message_id);
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
        title={`Previous branch: ${currentIndex + 1}`}
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
