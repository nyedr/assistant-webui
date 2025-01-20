import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { auth } from "@/app/(auth)/auth";
import { Chat } from "@/components/chat";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { convertToUIMessages } from "@/lib/utils";
import { DataStreamHandler } from "@/components/data-stream-handler";

async function fetchAvailableModels() {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8001";
  try {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    if (!response.ok) {
      console.error("Failed to fetch models from health endpoint");
      return null;
    }
    const data = await response.json();
    return data.components.models;
  } catch (error) {
    console.error("Error fetching models:", error);
    return null;
  }
}

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;
  const chat = await getChatById({ id });

  if (!chat) {
    notFound();
  }

  const session = await auth();

  const messagesFromDb = await getMessagesByChatId({
    id,
  });

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get("model-id")?.value;

  // Fetch available models
  const modelsData = await fetchAvailableModels();

  // Determine the selected model ID
  const selectedModelId = modelsData?.available?.includes(modelIdFromCookie)
    ? modelIdFromCookie
    : modelsData?.available?.[0] ?? // Use first available model
      DEFAULT_MODEL_NAME; // Fallback to default if no models available

  return (
    <>
      <Chat
        id={chat.id}
        initialMessages={convertToUIMessages(messagesFromDb)}
        selectedModelId={selectedModelId}
        isReadonly={session?.user?.id !== chat.userId}
      />
      <DataStreamHandler id={id} />
    </>
  );
}
