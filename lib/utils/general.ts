import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines multiple class names using clsx and tailwind-merge
 * Utility for conditional class name application
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Type for application errors with additional context
 */
interface ApplicationError extends Error {
  info: string;
  status: number;
}

/**
 * Generic data fetcher with error handling
 * Can be used with SWR or standalone
 */
export const fetcher = async (url: string) => {
  const res = await fetch(url);

  if (!res.ok) {
    const error = new Error(
      "An error occurred while fetching the data."
    ) as ApplicationError;

    error.info = await res.json();
    error.status = res.status;

    throw error;
  }

  return res.json();
};

/**
 * Truncates a string to a maximum length, adding ellipsis if needed
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

/**
 * Generates a UUID v4 string
 * @returns A new UUID string
 */
export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validates a UUID string against the standard UUID v4 format
 * @param uuid The UUID string to validate
 * @throws Error if UUID is invalid
 */
export function validateUUID(uuid: string): void {
  if (!uuid || typeof uuid !== "string") {
    throw new Error("UUID must be a non-empty string");
  }
  if (uuid.length !== 36) {
    throw new Error(`Invalid UUID length: ${uuid.length} characters`);
  }
  // Check format: 8-4-4-4-12 with valid hex digits
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      uuid
    )
  ) {
    throw new Error(`Invalid UUID format: ${uuid}`);
  }
}
