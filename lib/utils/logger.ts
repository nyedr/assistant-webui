/**
 * Simple logger utility with log levels and environment-based filtering
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogOptions {
  /**
   * Additional context data to include with the log
   */
  context?: Record<string, any>;

  /**
   * Module or component name for better filtering
   */
  module?: string;
}

class Logger {
  /**
   * Controls whether debug logs are displayed
   * Defaults to false in production, true in development
   */
  private showDebugLogs: boolean;

  constructor() {
    this.showDebugLogs = process.env.NODE_ENV !== "production";
  }

  /**
   * Enable or disable debug logs
   */
  setDebugLogging(enabled: boolean): void {
    this.showDebugLogs = enabled;
  }

  /**
   * Format a log entry with timestamp, level, and context
   */
  private formatLog(
    level: LogLevel,
    message: string,
    options?: LogOptions
  ): string {
    const timestamp = new Date().toISOString();
    const modulePrefix = options?.module ? `[${options.module}] ` : "";
    let logString = `${timestamp} ${level.toUpperCase()} ${modulePrefix}${message}`;

    // Add context data if provided
    if (options?.context) {
      try {
        const contextStr = JSON.stringify(options.context);
        logString += ` | Context: ${contextStr}`;
      } catch (e) {
        logString += ` | Context: [Object cannot be stringified]`;
      }
    }

    return logString;
  }

  /**
   * Log a debug message
   * Only appears in development or when debug logging is enabled
   */
  debug(message: string, options?: LogOptions): void {
    if (this.showDebugLogs) {
      console.log(this.formatLog("debug", message, options));
    }
  }

  /**
   * Log an informational message
   */
  info(message: string, options?: LogOptions): void {
    console.info(this.formatLog("info", message, options));
  }

  /**
   * Log a warning message
   */
  warn(message: string, options?: LogOptions): void {
    console.warn(this.formatLog("warn", message, options));
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error, options?: LogOptions): void {
    const context = {
      ...(options?.context || {}),
      errorName: error?.name,
      errorMessage: error?.message,
      stack: error?.stack,
    };

    console.error(
      this.formatLog("error", message, {
        ...options,
        context,
      })
    );
  }
}

// Create a singleton instance for the application
const logger = new Logger();

export default logger;
