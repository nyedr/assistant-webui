"use client";

import { motion } from "framer-motion";
import { Button } from "./ui/button";
import { memo } from "react";
import { toast } from "sonner";

import { createNewChat, updateChatMessages } from "@/app/(chat)/actions";
import { generateUUID } from "@/lib/utils";
import { ChatRequestOptions } from "@/hooks/use-ai-chat";
import { CreateMessage, Message } from "ai";

interface SuggestedActionsProps {
  chatId: string;
  append: (
    message: Message | CreateMessage,
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
}

function PureSuggestedActions({ chatId, append }: SuggestedActionsProps) {
  const suggestedActions = [
    {
      title: "What are the advantages",
      label: "of using Next.js?",
      action: "What are the advantages of using Next.js?",
    },
    {
      title: "Write code to",
      label: `demonstrate djikstra's algorithm`,
      action: `Write code to demonstrate djikstra's algorithm`,
    },
    {
      title: "Help me write an essay",
      label: `about silicon valley`,
      action: `Help me write an essay about silicon valley`,
    },
    {
      title: "What is the weather",
      label: "in San Francisco?",
      action: "What is the weather in San Francisco?",
    },
  ];

  return (
    <div className="grid sm:grid-cols-2 gap-2 w-full">
      {suggestedActions.map((suggestedAction, index) => (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * index }}
          key={`suggested-action-${suggestedAction.title}-${index}`}
          className={index > 1 ? "hidden sm:block" : "block"}
        >
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                const title = suggestedAction.action.slice(0, 50);
                const result = await createNewChat(title);
                if (!result.success) {
                  throw new Error("Failed to create chat");
                }
                window.history.replaceState({}, "", `/chat/${result.id}`);

                const userMessage: Message = {
                  content: suggestedAction.action,
                  id: generateUUID(),
                  role: "user",
                };

                await updateChatMessages(result.id, [userMessage]);

                append({
                  role: "user",
                  content: suggestedAction.action,
                });
              } catch (error) {
                console.error("Error creating chat:", error);
                toast.error("Failed to create chat. Please try again.");
              }
            }}
            className="text-left border rounded-xl px-4 py-3.5 text-sm flex-1 gap-1 sm:flex-col w-full h-auto justify-start items-start"
          >
            <span className="font-medium">{suggestedAction.title}</span>
            <span className="text-muted-foreground">
              {suggestedAction.label}
            </span>
          </Button>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(PureSuggestedActions, () => true);
