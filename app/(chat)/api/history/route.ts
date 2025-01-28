import { getAllChats } from "@/app/(chat)/actions";

export async function GET() {
  const chats = await getAllChats();
  return Response.json(chats);
}
