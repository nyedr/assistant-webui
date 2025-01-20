import { openai } from "@ai-sdk/openai";
import { experimental_wrapLanguageModel as wrapLanguageModel } from "ai";

import { customMiddleware } from "./custom-middleware";

// Export the useModels hook for components that need to access model information
export { useModels } from "./models";

export const customModel = (apiIdentifier: string) => {
  return wrapLanguageModel({
    model: openai(apiIdentifier),
    middleware: customMiddleware,
  });
};

export const imageGenerationModel = openai.image("dall-e-3");

// Helper function to check if a model is available
export const isModelAvailable = async (modelId: string) => {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/health`
    );
    if (!response.ok) return false;

    const data = await response.json();
    return data.components.models.available.includes(modelId);
  } catch {
    return false;
  }
};
