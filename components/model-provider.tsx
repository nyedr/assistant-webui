"use client";

import { useModels } from "@/hooks/use-api";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";
import { useEffect } from "react";
import { useCookies } from "next-client-cookies";

export function ModelProvider({
  children,
  onModelSelect,
}: {
  children: React.ReactNode;
  onModelSelect: (modelId: string) => void;
}) {
  const cookies = useCookies();
  const { models, isLoading } = useModels();
  const modelIdFromCookie = cookies.get("model-id");

  useEffect(() => {
    if (!isLoading && models.length > 0) {
      const selectedModelId = models.some((m) => m.id === modelIdFromCookie)
        ? modelIdFromCookie
        : models[0]?.id ?? DEFAULT_MODEL_NAME;

      onModelSelect(selectedModelId || DEFAULT_MODEL_NAME);
    }
  }, [models, isLoading, modelIdFromCookie, onModelSelect]);

  return children;
}
