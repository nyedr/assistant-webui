import React, { useState } from "react";
import { Message } from "ai";
import { Button } from "./ui/button";
import ChatMarkdown from "./markdown";
import { BrainCircuit } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

interface ReasoningViewProps {
  message: Message;
}

export function ReasoningView({ message }: ReasoningViewProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Check if reasoning exists in the message
  const hasReasoning =
    message.reasoning &&
    typeof message.reasoning === "string" &&
    message.reasoning.trim() !== "";

  if (!hasReasoning) {
    return null;
  }

  return (
    <div className="mt-2 rounded-md border border-muted">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between p-2 bg-muted/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BrainCircuit size={14} />
            <span>Model reasoning</span>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {isOpen ? "Hide" : "Show"} reasoning
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="p-3 text-sm bg-muted/20 rounded-b-md">
            <ChatMarkdown content={message.reasoning as string} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
