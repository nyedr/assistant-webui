"use server";

import { type CoreUserMessage, generateText } from "ai";
import { cookies } from "next/headers";

import { customModel } from "@/lib/ai";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
} from "@/lib/db/queries";

export async function saveModelId(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("model-id", model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: CoreUserMessage;
}) {
  // Use the DEFAULT_MODEL_NAME as fallback
  const cookieStore = await cookies();
  const modelId = cookieStore.get("model-id")?.value ?? DEFAULT_MODEL_NAME;

  const { text: title } = await generateText({
    model: customModel(modelId),
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}
