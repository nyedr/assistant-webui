/**
 * Simplified Chat Middleware System
 *
 * A streamlined middleware system focusing on request lifecycle hooks.
 */

import type { ExtendedMessage } from "@/lib/utils/messages";

/**
 * Chat status type
 */
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

/**
 * Request lifecycle middleware
 */
export interface ChatMiddleware {
  /**
   * Name of the middleware for identification
   */
  name: string;

  /**
   * Priority (lower numbers run first)
   */
  priority?: number;

  /**
   * Called before a request is initiated
   */
  beforeRequest?: (messages: ExtendedMessage[]) => void | Promise<void>;

  /**
   * Called after a request has completed successfully
   */
  afterRequest?: (messages: ExtendedMessage[]) => void | Promise<void>;

  /**
   * Called when a request fails
   */
  onRequestError?: (
    error: Error,
    messages: ExtendedMessage[]
  ) => void | Promise<void>;
}

/**
 * Middleware configuration
 */
export interface MiddlewareConfig {
  /**
   * Array of middleware to apply
   */
  middlewares: ChatMiddleware[];
}

/**
 * Default empty array of middlewares
 */
export const builtInMiddlewares: ChatMiddleware[] = [];

/**
 * Execute before-request middleware
 */
export async function executeBeforeRequestMiddleware(
  messages: ExtendedMessage[],
  middlewares: ChatMiddleware[]
): Promise<void> {
  const filteredMiddlewares = middlewares
    .filter((m) => m.beforeRequest)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));

  for (const middleware of filteredMiddlewares) {
    await middleware.beforeRequest!(messages);
  }
}

/**
 * Execute after-request middleware
 */
export async function executeAfterRequestMiddleware(
  messages: ExtendedMessage[],
  middlewares: ChatMiddleware[]
): Promise<void> {
  const filteredMiddlewares = middlewares
    .filter((m) => m.afterRequest)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));

  for (const middleware of filteredMiddlewares) {
    await middleware.afterRequest!(messages);
  }
}

/**
 * Execute on-request-error middleware
 */
export async function executeOnRequestErrorMiddleware(
  error: Error,
  messages: ExtendedMessage[],
  middlewares: ChatMiddleware[]
): Promise<void> {
  const filteredMiddlewares = middlewares
    .filter((m) => m.onRequestError)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));

  for (const middleware of filteredMiddlewares) {
    await middleware.onRequestError!(error, messages);
  }
}

/**
 * Get combined middlewares
 */
export function getCombinedMiddlewares(
  config?: MiddlewareConfig
): ChatMiddleware[] {
  if (!config) {
    return [];
  }

  return config.middlewares || [];
}
