import { Message } from "ai";

interface ChatMessageRequest {
  role: Message["role"];
  content: Message["content"];
  metadata?: Record<string, unknown>;
}

const chatMessageToRequest = (message: Message): ChatMessageRequest => {
  return {
    role: message.role,
    content: message.content,
  };
};

export interface ChatOptions {
  messages: Array<Message>;
  model?: string;
  temperature?: number;
  stream?: boolean;
  max_tokens?: number;
  enable_tools?: boolean;
  enable_memory?: boolean;
  memory_type?: string;
  conversation_id?: string;
  pipeline?: string;
  filters?: string[];
}

export interface ModelResponse {
  content: string;
  role: "assistant";
  toolCalls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

export const customModel = async (
  options: ChatOptions
): Promise<ModelResponse> => {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new Error("API base URL not configured");

  const formattedMessages = options.messages.map(chatMessageToRequest);

  const response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: formattedMessages,
      model: options.model,
      temperature: options.temperature,
      stream: options.stream ?? true,
      max_tokens: options.max_tokens,
      enable_tools: options.enable_tools ?? true,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  if (options.stream) {
    return {
      content: "",
      role: "assistant",
    };
  }

  const data = await response.json();
  return {
    content: data.content,
    role: "assistant",
    toolCalls: data.tool_calls,
  };
};

export interface ImageGenerationOptions {
  prompt: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
  quality?: "standard" | "hd";
  n?: number;
}

export const generateImage = async (options: ImageGenerationOptions) => {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new Error("API base URL not configured");

  const response = await fetch(`${baseUrl}/images/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: options.prompt,
      size: options.size || "1024x1024",
      quality: options.quality || "standard",
      n: options.n || 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data;
};

// Helper function to check if a model is available
export const isModelAvailable = async (modelId: string) => {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!baseUrl) throw new Error("API base URL not configured");

    const response = await fetch(`${baseUrl}/api/v1/health`);
    if (!response.ok) return false;

    const data = await response.json();
    return data.components.models.available.includes(modelId);
  } catch {
    return false;
  }
};
