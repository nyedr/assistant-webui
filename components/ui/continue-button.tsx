"use client";

import { Button } from "@/components/ui/button";
import { SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";

export interface ContinueButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  chatId: string;
  messageId: string;
  continue: () => void;
  scrollToMessage?: (messageId: string) => void;
  asChild?: boolean;
}

const ContinueButton = forwardRef<HTMLButtonElement, ContinueButtonProps>(
  (
    {
      continue: onContinue,
      chatId,
      messageId,
      scrollToMessage,
      asChild = false,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    const handleContinue = (e: React.MouseEvent<HTMLButtonElement>) => {
      // Call the original onClick if provided
      onClick?.(e);

      onContinue();

      // If scrollToMessage is provided, scroll to this message
      if (scrollToMessage && messageId) {
        setTimeout(() => {
          scrollToMessage(messageId);
        }, 100);
      }
    };

    const baseClassName = cn("text-muted-foreground", className);
    const Comp = asChild ? Slot : Button;

    return (
      <Comp
        ref={ref}
        variant="ghost"
        size="icon"
        aria-label="Continue"
        onClick={handleContinue}
        className={baseClassName}
        {...props}
      >
        <SkipForward className="h-4 w-4" />
      </Comp>
    );
  }
);

ContinueButton.displayName = "ContinueButton";

export default ContinueButton;
