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
