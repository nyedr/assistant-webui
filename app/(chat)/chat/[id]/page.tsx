import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { Chat } from "@/components/chat";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";
import { getChatById } from "@/app/(chat)/actions";
import { parseChatFromDB } from "@/lib/utils";

async function fetchAvailableModels() {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";
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

  // Get messages only if we have a valid chat
  console.log("Chat result:", chat);

  const { messages } = chat;

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get("model-id")?.value;

  // Fetch available models
  const modelsData = await fetchAvailableModels();

  // Determine the selected model ID
  const selectedModelId =
    modelIdFromCookie || // Prioritize cookie value
    (modelsData?.available?.[0] ?? DEFAULT_MODEL_NAME); // Only use default if no cookie

  return (
    <Chat
      id={chatResult.data.id}
      initialMessages={messages}
      selectedModelId={selectedModelId}
    />
  );
}
