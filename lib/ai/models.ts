// Define model types and re-export from the API hook
export interface Model {
  id: string;
  label: string;
  apiIdentifier: string;
  description: string;
}

// Re-export the hook and related types
export { useModels } from "../../hooks/use-api";

// Note: DEFAULT_MODEL_NAME is now dynamically determined in the useModels hook
// but we'll keep a fallback here for type safety
export const DEFAULT_MODEL_NAME = "deepseek/deepseek-chat";
