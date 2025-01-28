import { cookies } from "next/headers";
import { generateUUID } from "@/lib/utils";
import { Chat } from "@/components/chat";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";

export default async function Page() {
  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get("model-id")?.value;

  // Use default model if no cookie value
  const selectedModelId = modelIdFromCookie || DEFAULT_MODEL_NAME;

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
