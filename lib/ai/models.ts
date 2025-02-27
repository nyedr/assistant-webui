// Define model types and re-export from the API hook

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export interface ChatModel {
  id: string;
  name: string;
  description: string;
  created: number;
  context_length: number;
  architecture: {
    modality: string;
    tokenizer: string;
    instruct_type: string | null;
  };
  pricing: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
    is_moderated: boolean;
  };
  per_request_limits: any | null;
}

// Add a type for the model display in the selector
export interface ModelDisplay {
  id: string;
  label: string;
  description: string;
  modality: string;
  contextLength: number;
  maxOutputTokens: number | null;
  pricing: {
    prompt: string;
    completion: string;
  };
  isModerated: boolean;
  tokenizer: string;
}

export interface ModelsApiResponse {
  models: ChatModel[];
}

// Note: DEFAULT_MODEL_NAME is now dynamically determined in the useModels hook
// but we'll keep a fallback here for type safety
export const DEFAULT_MODEL_NAME = process.env.NEXT_PUBLIC_DEFAULT_MODEL!;

export const myProvider = createOpenAICompatible({
  baseURL: process.env.NEXT_PUBLIC_CHAT_BASE_URL!,
  name: process.env.NEXT_PUBLIC_CHAT_PROVIDER!,
  apiKey: process.env.NEXT_PUBLIC_CHAT_API_KEY,
}).chatModel(DEFAULT_MODEL_NAME);

// Fetch models function for server-side use
export async function fetchModels(): Promise<ModelsApiResponse> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_CHAT_BASE_URL}/models`,
    {
      headers: {
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_CHAT_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Error fetching models");
  }

  return response.json();
}

// Transform models for display
export function transformModels(models: ChatModel[]): ModelDisplay[] {
  return models.map((model) => ({
    id: model.id,
    label: model.name,
    description: model.description,
    modality: model.architecture.modality,
    contextLength: model.context_length,
    maxOutputTokens: model.top_provider.max_completion_tokens,
    pricing: {
      prompt: model.pricing.prompt,
      completion: model.pricing.completion,
    },
    isModerated: model.top_provider.is_moderated,
    tokenizer: model.architecture.tokenizer,
  }));
}
