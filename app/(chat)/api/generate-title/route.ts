import { NextResponse } from "next/server";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";
import { cookies } from "next/headers";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    const cookieStore = await cookies();
    const modelId = cookieStore.get("model-id")?.value ?? DEFAULT_MODEL_NAME;

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/chat/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: `
              - you will generate a short title based on the first message a user begins a conversation with
              - ensure it is not more than 80 characters long
              - the title should be a summary of the user's message
              - do not use quotes or colons
              - respond ONLY with the title, no additional text
            `,
            },
            {
              role: "user",
              content: message,
            },
          ],
          model: modelId,
          stream: false,
          max_tokens: 100,
        }),
      }
    );

    if (!response.ok) {
      console.warn("Title generation failed, using default title");
      return NextResponse.json({ title: "New Chat" });
    }

    const data = await response.json();
    return NextResponse.json({ title: data.content || "New Chat" });
  } catch (error) {
    console.warn("Error generating title:", error);
    return NextResponse.json({ title: "New Chat" });
  }
}
