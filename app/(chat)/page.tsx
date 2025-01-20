"use client";

import { Chat } from "@/components/chat";
import { generateUUID } from "@/lib/utils";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { ModelProvider } from "@/components/model-provider";
import { useState } from "react";

export default function Page() {
  const id = generateUUID();
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  return (
    <ModelProvider onModelSelect={setSelectedModelId}>
      {selectedModelId && (
        <>
          <Chat
            key={id}
            id={id}
            initialMessages={[]}
            selectedModelId={selectedModelId}
            isReadonly={false}
          />
          <DataStreamHandler id={id} />
        </>
      )}
    </ModelProvider>
  );
}
