/**
 * @deprecated This file is deprecated. Import from '@/lib/utils/...' instead.
 *
 * For example:
 * - Instead of: import { cn } from '@/lib/utils';
 * - Use: import { cn } from '@/lib/utils/general';
 *
 * Or use the index file to import everything:
 * - import { cn, fetcher, generateUUID } from '@/lib/utils';
 */

// Re-export directly from each module to avoid circular dependencies
export * from "./utils/general";
export * from "./utils/storage";
export * from "./utils/uuid";
export * from "./utils/models";
export * from "./utils/messages";
