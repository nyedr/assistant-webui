import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { Chat } from "@/components/chat";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";
import { getChatById } from "@/app/(chat)/actions";
import { parseChatFromDB } from "@/lib/utils";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  // Get chat data with proper error handling
  const chatResult = await getChatById({ id });

  // Handle different response states
  if (chatResult.status === 404 || !chatResult.data) {
    notFound();
  }

  if (chatResult.status === 500 || chatResult.error) {
    throw new Error(chatResult.error || "Failed to load chat");
  }

  if (!chatResult.data.chat) {
    throw new Error("Chat data is missing");
  }

  const chat = parseChatFromDB(chatResult.data.chat);
  const { messages } = chat;

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get("model-id")?.value;

  // Use default model if no cookie value
  const selectedModelId = modelIdFromCookie || DEFAULT_MODEL_NAME;

  return (
    <Chat
      id={chatResult.data.id}
      initialMessages={messages}
      selectedModelId={selectedModelId}
    />
  );
}
