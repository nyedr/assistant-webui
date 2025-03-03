/**
 * Main utility exports index file
 * This file re-exports all utilities from the individual modules
 * for ease of importing throughout the application
 */

// Re-export all utilities for ease of importing
export * from "./general";
export * from "./storage";
export * from "./uuid";
export * from "./models";
export * from "./messages";

// For backward compatibility - allow importing the old way
// but with the new organization under the hood

// Note: When adding new utility files, make sure to export them here
// to maintain the ability to import from '@/lib/utils'
