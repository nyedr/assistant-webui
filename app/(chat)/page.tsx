import { cookies } from "next/headers";
import { Chat } from "@/components/chat";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { generateUUID } from "@/lib/utils";

export default async function Page() {
  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get("model-id")?.value;

  // Use default model if no cookie value
  const selectedModelId = modelIdFromCookie || DEFAULT_MODEL_NAME;

  // No longer generate UUID - chat will be created when first message is sent
  const id = generateUUID();

  console.log("Page rendered with NEW chat id:", id);

  // Display the chat interface directly instead of redirecting
  return (
    <>
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        selectedModelId={selectedModelId}
      />
      <DataStreamHandler id={id} />
    </>
  );
}
