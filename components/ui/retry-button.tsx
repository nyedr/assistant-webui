"use client";

import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";

export interface RetryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onRetry: () => Promise<string | null | undefined>;
  isLoading?: boolean;
  asChild?: boolean;
  messageId?: string;
  chatId?: string;
  model?: string;
}

const RetryButton = forwardRef<HTMLButtonElement, RetryButtonProps>(
  (
    {
      onRetry,
      isLoading = false,
      asChild = false,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    const handleRetry = async (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isLoading) return;

      // Call the original onClick if provided
      onClick?.(e);

      try {
        await onRetry();
      } catch (error) {
        console.error("Failed to regenerate message:", error);
        toast.error("Failed to regenerate message. Please try again.");
      }
    };

    const baseClassName = cn(
      "transition-all duration-200",
      isLoading
        ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        : "text-muted-foreground",
      className
    );

    const icon = isLoading ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      <RefreshCw className="h-4 w-4" />
    );

    const Comp = asChild ? Slot : Button;

    return (
      <Comp
        ref={ref}
        variant="ghost"
        size="icon"
        onClick={handleRetry}
        disabled={isLoading}
        aria-label="Regenerate this message"
        className={baseClassName}
        {...props}
      >
        {icon}
      </Comp>
    );
  }
);

RetryButton.displayName = "RetryButton";

export default RetryButton;
