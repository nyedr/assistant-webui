import { z } from "zod";
import { createDocumentHandler, type DataStream } from "@/lib/artifacts/server";
import { codePrompt, updateDocumentPrompt } from "@/lib/ai/prompts";

const NEXT_PUBLIC_CHAT_API_KEY = process.env.NEXT_PUBLIC_CHAT_API_KEY;
const DEFAULT_MODEL = process.env.NEXT_PUBLIC_DEFAULT_MODEL;

async function* streamCompletion(
  messages: Array<{ role: string; content: string }>
) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_CHAT_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NEXT_PUBLIC_CHAT_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        stream: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader available");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        if (line.trim() === "data: [DONE]") continue;

        const data = line.replace(/^data: /, "");
        try {
          const json = JSON.parse(data);
          if (json.choices?.[0]?.delta?.content) {
            yield json.choices[0].delta.content;
          }
        } catch (e) {
          console.error("Error parsing JSON:", e);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const codeDocumentHandler = createDocumentHandler<"code">({
  kind: "code",
  onCreateDocument: async ({
    title,
    dataStream,
  }: {
    title: string;
    dataStream: DataStream;
  }) => {
    let draftContent = "";

    try {
      for await (const content of streamCompletion([
        { role: "system", content: codePrompt },
        { role: "user", content: title },
      ])) {
        dataStream.writeData({
          type: "code-delta",
          content,
        });
        draftContent += content;
      }
    } catch (error) {
      console.error("Error in code generation:", error);
      throw error;
    }

    return draftContent;
  },
  onUpdateDocument: async ({
    document,
    description,
    dataStream,
  }: {
    document: { content: string };
    description: string;
    dataStream: DataStream;
  }) => {
    let draftContent = "";

    try {
      for await (const content of streamCompletion([
        {
          role: "system",
          content: updateDocumentPrompt(document.content, "code"),
        },
        { role: "user", content: description },
      ])) {
        dataStream.writeData({
          type: "code-delta",
          content,
        });
        draftContent += content;
      }
    } catch (error) {
      console.error("Error in code update:", error);
      throw error;
    }

    return draftContent;
  },
});
