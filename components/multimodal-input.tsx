"use client";

import type React from "react";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
} from "react";
import { toast } from "sonner";
import { useWindowSize } from "usehooks-ts";

import { cn, sanitizeUIMessages, truncateString } from "@/lib/utils";

import { createNewChat } from "@/app/(chat)/actions";

import { ArrowUpIcon, PaperclipIcon, StopIcon } from "./icons";
import { PreviewAttachment } from "./preview-attachment";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import equal from "fast-deep-equal";
import { Message, Attachment } from "ai";
import { ExtendedRequestOptions } from "@/hooks/use-ai-chat";

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  isLoading,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  handleSubmit,
  className,
}: {
  chatId: string;
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<Message>;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  handleSubmit: (
    event?: React.FormEvent<HTMLFormElement>,
    chatRequestOptions?: ExtendedRequestOptions
  ) => Promise<void>;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);

  console.log("MultimodalInput rendered with chatId:", chatId);

  const adjustHeight = () => {
    if (textareaRef.current) {
      // Store the current scroll position
      const scrollTop = textareaRef.current.scrollTop;

      // Reset height to calculate the actual scrollHeight correctly
      textareaRef.current.style.height = "auto";

      // Get the scrollHeight (content height)
      const scrollHeight = textareaRef.current.scrollHeight;

      // Get the maximum height from CSS (75vh converted to pixels)
      const maxHeight = window.innerHeight * 0.75;

      // Use the lower of scrollHeight or maxHeight for the textarea height
      const newHeight = Math.min(scrollHeight + 2, maxHeight);
      textareaRef.current.style.height = `${newHeight}px`;

      // Restore the scroll position
      textareaRef.current.scrollTop = scrollTop;
    }
  };

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = "44px";
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  // Adjust height when window resizes
  useEffect(() => {
    if (width) {
      adjustHeight();
    }
  }, [width]);

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || "";
      setInput(finalValue);
      adjustHeight();
    }
  }, []);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Preserve the current cursor position before adjusting
    const selectionStart = event.target.selectionStart;
    const selectionEnd = event.target.selectionEnd;

    const newValue = event.target.value;
    setInput(newValue);
    // Ensure local storage is updated in sync with input state
    adjustHeight();

    // After React updates the component and adjusts height,
    // restore the cursor position
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = selectionStart;
        textareaRef.current.selectionEnd = selectionEnd;
      }
    });
  };

  const submitForm = useCallback(async () => {
    try {
      // IMPORTANT: Always use the parent's chat ID instead of creating a new one
      const currentChatId = chatId;
      const userContent = input;
      const currentAttachments = [...attachments];

      console.log(
        `submitForm using chatId: ${currentChatId} (existing messages: ${messages.length})`
      );

      // DEBUG: Log the input before clearing
      console.log("[DEBUG] User input before clearing:", userContent);

      setInput("");
      setAttachments([]);
      resetHeight();

      // Only create new chat in the database if this is the first message
      // but use the same ID that was generated in the parent component
      if (messages.length === 0) {
        const chatTitle = truncateString(userContent, 20);

        console.log(`Chat ${currentChatId} doesn't exist yet, creating it`);
        const result = await createNewChat(chatTitle, currentChatId);

        if (!result.success) {
          throw new Error("Failed to create chat");
        }

        // Ensure we're using the ID from the parent
        if (result.id !== currentChatId) {
          console.warn(
            `Warning: Created chat ID ${result.id} differs from parent ID ${currentChatId}`
          );
        }
      }

      // Set the URL to the current chat ID
      window.history.replaceState({}, "", `/chat/${currentChatId}`);

      // Let handleSubmit create the user message with proper parent relationships
      // and handle the AI response
      console.log(`Invoking AI with ${currentAttachments.length} attachments`);
      await handleSubmit(undefined, {
        experimental_attachments: currentAttachments,
      });

      if (width && width > 768) {
        textareaRef.current?.focus();
      }
    } catch (error) {
      console.error("Error submitting message:", error);
      if (error instanceof Error) {
        console.error(`Error details: ${error.message}`);
        if (error.message.includes("Chat not found")) {
          console.error(
            `Chat ID ${chatId} not found in database. This indicates a potential ID mismatch.`
          );
        }
      }

      toast.error("Failed to send message. Please try again.");
    }
  }, [
    attachments,
    handleSubmit,
    setAttachments,
    width,
    chatId,
    messages,
    input,
  ]);

  const uploadFile = async (file: File): Promise<Attachment | undefined> => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch {
      toast.error("Failed to upload file, please try again!");
    }
  };

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment): attachment is Attachment => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error("Error uploading files!", error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments]
  );

  return (
    <div className="mx-auto text-base px-3 w-full md:px-5 lg:px-4 xl:px-5">
      <div className="mx-auto flex flex-1 text-base gap-4 md:gap-5 lg:gap-6 md:max-w-3xl">
        {/* This div is for alignment with other elements in the chat UI */}
        <div className="flex justify-center empty:hidden"></div>

        <form
          className="w-full"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isLoading) {
              submitForm();
            }
          }}
        >
          <div className="relative z-[1] flex h-full max-w-full flex-1 flex-col">
            <div className="absolute bottom-full left-0 right-0 z-20">
              {/* Attachments preview area */}
              {(attachments.length > 0 || uploadQueue.length > 0) && (
                <div className="flex flex-row gap-2 overflow-x-auto items-end mb-2">
                  {attachments.map((attachment) => (
                    <PreviewAttachment
                      key={attachment.url}
                      attachment={attachment}
                    />
                  ))}

                  {uploadQueue.map((filename) => (
                    <PreviewAttachment
                      key={filename}
                      attachment={{
                        url: "",
                        name: filename,
                        contentType: "",
                      }}
                      isUploading={true}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="group relative z-[1] flex w-full items-center">
              <div className="w-full">
                <div
                  id="composer-background"
                  className="flex w-full cursor-text min-h-[116px] justify-between flex-col rounded-3xl border px-3 py-1 duration-150 ease-in-out shadow-[0_2px_12px_0px_rgba(0,0,0,0.04),_0_9px_9px_0px_rgba(0,0,0,0.01),_0_2px_5px_0px_rgba(0,0,0,0.06)] bg-background dark:bg-[#303030] dark:border-none dark:shadow-none has-[:focus]:shadow-[0_2px_12px_0px_rgba(0,0,0,0.04),_0_9px_9px_0px_rgba(0,0,0,0.01),_0_2px_5px_0px_rgba(0,0,0,0.06)]"
                  onClick={(event) => {
                    // Check if the clicked element is not a button
                    const target = event.target as HTMLElement;
                    const isButton =
                      target.tagName === "BUTTON" ||
                      target.closest("button") !== null;

                    // Only focus the textarea if we're not clicking on a button
                    if (!isButton && textareaRef.current) {
                      textareaRef.current.focus();
                    }
                  }}
                >
                  <div className="flex flex-col justify-start">
                    <div className="flex min-h-[44px] items-start pl-1">
                      <div className="min-w-0 max-w-full flex-1">
                        <Textarea
                          ref={textareaRef}
                          placeholder="Ask anything..."
                          value={input}
                          onChange={handleInput}
                          className={cn(
                            "min-h-[24px] max-h-[calc(75dvh)] overflow-y-auto resize-none !border-0 !shadow-none !bg-transparent !p-0 !py-2 !rounded-none !text-base",
                            className
                          )}
                          rows={1}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();

                              if (isLoading) {
                                toast.error(
                                  "Please wait for the model to finish its response!"
                                );
                              } else {
                                submitForm();
                              }
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mb-2 mt-1 flex items-center justify-between sm:mt-2">
                    <div className="flex gap-x-1.5">
                      <input
                        type="file"
                        className="hidden"
                        ref={fileInputRef}
                        multiple
                        onChange={handleFileChange}
                        tabIndex={-1}
                      />
                      <Button
                        className="h-9 border-[#b5b5b5] rounded-full w-9 bg-muted hover:bg-accent"
                        onClick={(event) => {
                          event.preventDefault();
                          fileInputRef.current?.click();
                        }}
                        disabled={isLoading}
                        variant="outline"
                      >
                        <PaperclipIcon size={18} className="text-[#b5b5b5]" />
                      </Button>
                    </div>

                    <div className="flex gap-x-1.5">
                      {isLoading ? (
                        <Button
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-token-text-secondary hover:bg-muted dark:hover:bg-zinc-700"
                          onClick={(event) => {
                            event.preventDefault();
                            stop();
                            setMessages((messages) =>
                              sanitizeUIMessages(messages)
                            );
                          }}
                          variant="ghost"
                        >
                          <StopIcon size={14} />
                        </Button>
                      ) : (
                        <Button
                          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none disabled:text-[#f4f4f4] disabled:hover:opacity-100 dark:focus-visible:outline-white bg-black text-white dark:bg-white dark:text-black hover:opacity-70 disabled:bg-[#D7D7D7]"
                          onClick={(event) => {
                            event.preventDefault();
                            submitForm();
                          }}
                          disabled={
                            input.length === 0 || uploadQueue.length > 0
                          }
                        >
                          <ArrowUpIcon size={18} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (!equal(prevProps.attachments, nextProps.attachments)) return false;

    return true;
  }
);
