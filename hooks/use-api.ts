"use client";

import { useState, useEffect } from "react";

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

// Helper function to get the API base URL from environment variables
const getApiBaseUrl = () => {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) {
    console.warn("NEXT_PUBLIC_API_BASE_URL is not defined");
    return "http://localhost:8001";
  }
  return baseUrl;
};

// Cache storage for API responses
const apiCache: Record<string, { data: any; timestamp: number }> = {};
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
      const cachedData = apiCache[cacheKey];

      if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
        setState({ data: cachedData.data, error: null, isLoading: false });
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
        apiCache[cacheKey] = {
          data,
          timestamp: Date.now(),
        };

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
  }, [
    endpoint,
    options?.method,
    options?.body,
    options?.headers,
    setState,
    options,
  ]);

  return state;
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
