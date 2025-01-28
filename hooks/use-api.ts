"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface EndpointStatus {
  connected: boolean;
  message: string;
  base_url: string;
}

export interface ModelsComponent {
  status: string;
  count: number;
  available: string[];
  endpoints_status: Record<string, EndpointStatus>;
}

export interface HealthResponse {
  status: string;
  components: {
    services: Record<
      string,
      {
        status: string;
        status_icon: string;
        error: string | null;
      }
    >;
    models: ModelsComponent;
    tools: {
      status: string;
      count: number;
      registered: string[];
    };
    filters: {
      status: string;
      count: number;
      registered: string[];
    };
    pipelines: {
      status: string;
      count: number;
      registered: string[];
    };
  };
}

interface ApiState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ToolCallPayload {
  tool_call_id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCallEvent {
  tool_calls: ToolCallPayload[];
}

export interface StreamCallbacks {
  onMessage: (content: string) => void;
  onToolCall: (tool: ToolCallPayload) => void;
  onPhaseStart: () => void;
  onPhaseComplete: () => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

export interface ChatCompletionChunkDelta {
  content: string | null;
  role: string | null;
  tool_calls: ToolCallPayload[] | null;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

// Helper function to get the API base URL from environment variables
const getApiBaseUrl = () => {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) {
    console.warn("NEXT_PUBLIC_API_BASE_URL is not defined");
    return "http://127.0.0.1:8001";
  }
  // Always convert to IPv4
  return baseUrl.replace(/localhost|::1/g, "127.0.0.1");
};

// Cache storage for API responses
type CacheEntry<T> = { data: T; timestamp: number };
const apiCache = new Map<string, CacheEntry<unknown>>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

export function useApi<T>(endpoint: string, options?: FetchOptions) {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    error: null,
    isLoading: true,
  });

  useEffect(() => {
    const fetchData = async () => {
      // Check cache first
      const cacheKey = `${endpoint}-${JSON.stringify(options)}`;
      const cachedData = apiCache.get(cacheKey);

      if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
        setState({ data: cachedData.data as T, error: null, isLoading: false });
        return;
      }

      try {
        const baseUrl = getApiBaseUrl();
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: options?.method || "GET",
          headers: {
            "Content-Type": "application/json",
            ...options?.headers,
          },
          ...(options?.body ? { body: options.body } : {}),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Update cache
        apiCache.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });

        setState({ data, error: null, isLoading: false });
      } catch (error) {
        setState({
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
          isLoading: false,
        });
      }
    };

    fetchData();
  }, [endpoint, options?.method, options?.body, options?.headers, options]);

  return state;
}

export function useChatStream({
  onMessage,
  onToolCall,
  onPhaseStart,
  onPhaseComplete,
  onError,
  onComplete,
}: StreamCallbacks) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const activeStreamRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingChunksRef = useRef<string[]>([]);

  // Track mounted state
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      // Clear any existing cleanup timeout
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }

      // Process any pending chunks before cleanup
      if (pendingChunksRef.current.length > 0) {
        console.log("[Stream] Processing pending chunks before unmount");
        pendingChunksRef.current.forEach((chunk) => {
          processStreamMessage(chunk);
        });
        pendingChunksRef.current = [];
      }

      // Wait longer before cleanup to handle Fast Refresh and ensure chunks are processed
      cleanupTimeoutRef.current = setTimeout(() => {
        // Only cleanup if component is still unmounted
        if (!isMountedRef.current) {
          console.log(
            "[Stream] Component confirmed unmounted, cleaning up stream"
          );
          activeStreamRef.current = false;
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }
        }
      }, 1000); // Increased timeout to better handle Fast Refresh and chunk processing
    };
  }, []);

  const processStreamMessage = useCallback(
    (message: string) => {
      console.log("[Stream] Processing message:", message);

      try {
        const chunk: ChatCompletionChunk = JSON.parse(message);

        // Validate response structure
        if (
          chunk.object === "chat.completion.chunk" &&
          Array.isArray(chunk.choices) &&
          chunk.choices.length > 0
        ) {
          const choice = chunk.choices[0];
          const delta = choice.delta;

          // Handle content updates
          if (delta.content !== null && delta.content !== undefined) {
            console.log("[Stream] Content delta:", delta.content);
            onMessage(delta.content);
          }

          // Handle tool calls
          if (delta.tool_calls) {
            console.log("[Stream] Tool call delta:", delta.tool_calls);
            delta.tool_calls.forEach((tool: ToolCallPayload) => {
              onToolCall(tool);
            });
          }

          // Handle stream start (first chunk)
          if (
            choice.finish_reason === null &&
            !delta.content &&
            !delta.tool_calls
          ) {
            console.log("[Stream] Stream starting");
            onPhaseStart();
          }

          // Handle stream completion
          if (choice.finish_reason === "stop") {
            console.log("[Stream] Stream complete");
            onPhaseComplete();
          }

          // Handle stream errors
          if (choice.finish_reason === "error") {
            console.error("[Stream] Stream error");
            onError?.(new Error("Stream error"));
          }
        }
      } catch (error) {
        console.error("[Stream] Error processing message:", error);
        if (error instanceof Error) {
          onError?.(error);
        }
      }
    },
    [onMessage, onToolCall, onPhaseStart, onPhaseComplete, onError]
  );

  const startStream = useCallback(
    async (endpoint: string, body: unknown) => {
      // Reset mounted state and clear any pending cleanup
      isMountedRef.current = true;
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }

      // Set active stream flag
      activeStreamRef.current = true;

      try {
        const baseUrl = getApiBaseUrl();
        const url = `${baseUrl}${endpoint}`;
        console.log("[Stream] Starting request to:", url);
        console.log("[Stream] Request body:", JSON.stringify(body, null, 2));

        // Add error handling for base URL
        if (!baseUrl) {
          throw new Error("API base URL is not configured");
        }

        // Cancel any existing request
        if (abortControllerRef.current) {
          console.log("[Stream] Aborting previous request");
          abortControllerRef.current.abort();
          // Wait a bit for the previous request to clean up
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Create new abort controller for this request
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Make a single POST request that will stream the response
        console.log("[Stream] Sending POST request");
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
          body: JSON.stringify(body),
          signal: abortController.signal,
        }).catch((error) => {
          console.error("[Stream] Fetch error:", error);
          throw error;
        });

        console.log("[Stream] Response status:", response.status);
        console.log(
          "[Stream] Response headers:",
          Object.fromEntries(response.headers.entries())
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[Stream] Error response:", errorText);
          throw new Error(
            `HTTP error! status: ${response.status}, body: ${errorText}`
          );
        }

        if (!response.body) {
          throw new Error("ReadableStream not supported");
        }

        setIsConnected(true);
        console.log("[Stream] Connection established");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (activeStreamRef.current) {
            const { done, value } = await reader.read();

            if (done) {
              console.log("[Stream] Stream complete");
              if (buffer.trim()) {
                console.log("[Stream] Processing final buffer:", buffer);
                processStreamMessage(buffer.trim());
              }
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            console.log("[Stream] Received chunk:", chunk);
            buffer += chunk;

            // Split on newlines and process complete messages
            const messages = buffer.split(/\n/);
            buffer = messages.pop() || "";

            for (const message of messages) {
              if (message.trim() && activeStreamRef.current) {
                console.log("[Stream] Processing message:", message.trim());
                processStreamMessage(message.trim());
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            console.log("[Stream] Stream aborted");
          } else {
            console.error("[Stream] Processing error:", error);
            throw error;
          }
        } finally {
          reader.releaseLock();
          if (activeStreamRef.current) {
            setIsConnected(false);
            onComplete?.();
          }
          console.log("[Stream] Stream cleanup complete");
        }
      } catch (error) {
        console.error("[Stream] Stream error:", error);
        if (error instanceof Error) {
          console.error("[Stream] Error name:", error.name);
          console.error("[Stream] Error message:", error.message);
          console.error("[Stream] Error stack:", error.stack);
        }
        if (activeStreamRef.current) {
          onError?.(error instanceof Error ? error : new Error(String(error)));
          setIsConnected(false);
        }
      } finally {
        activeStreamRef.current = false;
        if (abortControllerRef.current) {
          abortControllerRef.current = null;
        }
      }
    },
    [onMessage, onToolCall, onPhaseStart, onPhaseComplete, onComplete, onError]
  );

  return {
    isConnected,
    startStream,
  };
}

export function useModels() {
  const { data, error, isLoading } = useApi<HealthResponse>("/api/v1/health");

  const models =
    data?.components.models.available.map((modelId) => ({
      id: modelId,
      label: modelId,
      apiIdentifier: modelId,
      description: `AI model: ${modelId}`,
    })) || [];

  const defaultModel = models[0]?.id || "";

  return {
    models,
    defaultModel,
    error,
    isLoading,
    endpointsStatus: data?.components.models.endpoints_status || {},
  };
}
