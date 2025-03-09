/**
 * Error Handling Utilities
 *
 * This module provides standardized error handling and logging functions
 * to ensure consistent error management throughout the application.
 */

import logger from "./logger";

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Low severity errors that don't impact core functionality */
  LOW = "low",
  /** Medium severity errors that impact some functionality but allow the app to continue */
  MEDIUM = "medium",
  /** High severity errors that significantly impact the application */
  HIGH = "high",
  /** Critical errors that prevent the application from functioning */
  CRITICAL = "critical",
}

/**
 * Custom error class with additional metadata
 */
export class AppError extends Error {
  /** Error code for categorization */
  public readonly code: string;
  /** Error severity level */
  public readonly severity: ErrorSeverity;
  /** Additional context information */
  public readonly context?: Record<string, unknown>;
  /** When the error occurred */
  public readonly timestamp: Date;
  /** Module where the error originated */
  public readonly module?: string;

  constructor(options: {
    message: string;
    code: string;
    severity?: ErrorSeverity;
    cause?: Error;
    context?: Record<string, unknown>;
    module?: string;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.severity = options.severity || ErrorSeverity.MEDIUM;
    this.context = options.context;
    this.timestamp = new Date();
    this.module = options.module;
  }

  /**
   * Get a formatted string representation of the error
   */
  public toString(): string {
    return `[${this.code}] ${this.message} (${this.severity})`;
  }

  /**
   * Get a structured object representation of the error
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp,
      module: this.module,
      stack: this.stack,
      cause: this.cause ? String(this.cause) : undefined,
    };
  }
}

/**
 * Error codes categorized by domain
 */
export const ErrorCodes = {
  NETWORK: {
    REQUEST_FAILED: "NETWORK_REQUEST_FAILED",
    TIMEOUT: "NETWORK_TIMEOUT",
    ABORTED: "NETWORK_ABORTED",
  },
  AUTH: {
    UNAUTHORIZED: "AUTH_UNAUTHORIZED",
    FORBIDDEN: "AUTH_FORBIDDEN",
    EXPIRED: "AUTH_EXPIRED",
  },
  CHAT: {
    STREAMING_FAILED: "CHAT_STREAMING_FAILED",
    INVALID_MESSAGE: "CHAT_INVALID_MESSAGE",
    MODEL_ERROR: "CHAT_MODEL_ERROR",
  },
  DATA: {
    NOT_FOUND: "DATA_NOT_FOUND",
    VALIDATION_ERROR: "DATA_VALIDATION_ERROR",
    PARSE_ERROR: "DATA_PARSE_ERROR",
  },
  INTERNAL: {
    UNKNOWN: "INTERNAL_UNKNOWN",
    STATE_ERROR: "INTERNAL_STATE_ERROR",
    INITIALIZATION_ERROR: "INTERNAL_INITIALIZATION_ERROR",
  },
};

/**
 * Log an error with standardized format
 * @param error - The error to log
 * @param context - Additional context information
 */
export function logError(
  error: Error | AppError | unknown,
  context?: Record<string, unknown>
): void {
  // Convert to AppError if not already
  const appError =
    error instanceof AppError
      ? error
      : error instanceof Error
      ? new AppError({
          message: error.message,
          code: ErrorCodes.INTERNAL.UNKNOWN,
          cause: error,
          context,
        })
      : new AppError({
          message: String(error),
          code: ErrorCodes.INTERNAL.UNKNOWN,
          context,
        });

  // Log based on severity
  const logData = appError.toJSON();
  const logOptions = {
    context: logData,
    module: appError.module || "error-handler",
  };

  switch (appError.severity) {
    case ErrorSeverity.LOW:
      logger.info(`Error: ${appError.message}`, logOptions);
      break;
    case ErrorSeverity.MEDIUM:
      logger.warn(`Error: ${appError.message}`, logOptions);
      break;
    case ErrorSeverity.HIGH:
    case ErrorSeverity.CRITICAL:
      logger.error(`Error: ${appError.message}`, appError, logOptions);
      break;
  }
}

/**
 * Handle an error by logging it and returning a standardized response
 * @param error - The error to handle
 * @param module - The module where the error occurred
 * @param context - Additional context information
 * @returns A standardized AppError instance
 */
export function handleError(
  error: Error | AppError | unknown,
  module?: string,
  context?: Record<string, unknown>
): AppError {
  // Convert to AppError if not already
  const appError =
    error instanceof AppError
      ? error
      : error instanceof Error
      ? new AppError({
          message: error.message,
          code: determineErrorCode(error),
          cause: error,
          context,
          module,
        })
      : new AppError({
          message: String(error),
          code: ErrorCodes.INTERNAL.UNKNOWN,
          context,
          module,
        });

  // Log the error
  logError(appError);

  return appError;
}

/**
 * Create a chat-specific error
 * @param message - Error message
 * @param code - Error code
 * @param context - Additional context
 * @returns An AppError with CHAT domain
 */
export function createChatError(
  message: string,
  code: keyof typeof ErrorCodes.CHAT = "MODEL_ERROR",
  context?: Record<string, unknown>
): AppError {
  return new AppError({
    message,
    code: ErrorCodes.CHAT[code],
    context,
    module: "chat",
  });
}

/**
 * Determine the appropriate error code based on the error type
 */
function determineErrorCode(error: Error): string {
  // Network errors
  if (error.name === "AbortError") {
    return ErrorCodes.NETWORK.ABORTED;
  }
  if (error.name === "TimeoutError") {
    return ErrorCodes.NETWORK.TIMEOUT;
  }
  if (error.name === "FetchError" || error.message.includes("fetch")) {
    return ErrorCodes.NETWORK.REQUEST_FAILED;
  }

  // Auth errors
  if (error.message.includes("401") || error.message.includes("unauthorized")) {
    return ErrorCodes.AUTH.UNAUTHORIZED;
  }
  if (error.message.includes("403") || error.message.includes("forbidden")) {
    return ErrorCodes.AUTH.FORBIDDEN;
  }

  // Data errors
  if (error.message.includes("404") || error.message.includes("not found")) {
    return ErrorCodes.DATA.NOT_FOUND;
  }
  if (error.message.includes("validation")) {
    return ErrorCodes.DATA.VALIDATION_ERROR;
  }
  if (error.message.includes("parse") || error.message.includes("JSON")) {
    return ErrorCodes.DATA.PARSE_ERROR;
  }

  // Default
  return ErrorCodes.INTERNAL.UNKNOWN;
}
