import { cookies } from "next/headers";
import { generateUUID } from "@/lib/utils";
import { Chat } from "@/components/chat";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";

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

export default async function Page() {
  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get("model-id")?.value;

  // Fetch available models
  const modelsData = await fetchAvailableModels();

  // Determine the selected model ID
  const selectedModelId =
    modelIdFromCookie || // Prioritize cookie value
    (modelsData?.available?.[0] ?? DEFAULT_MODEL_NAME); // Only use default if no cookie

  const id = generateUUID();

  // Display the chat interface directly instead of redirecting
  return (
    <Chat
      key={id}
      id={id}
      initialMessages={[]}
      selectedModelId={selectedModelId}
    />
  );
}
