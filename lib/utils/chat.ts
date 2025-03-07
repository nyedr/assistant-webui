import { Message } from "ai";

// Define protocol types supported by Vercel AI SDK
export type StreamProtocol = "text" | "data";

// Define tool invocation types
export type ToolInvocation =
  | ({ state: "partial-call"; step?: number } & ToolCall)
  | ({ state: "call"; step?: number } & ToolCall)
  | ({ state: "result"; step?: number } & ToolResult);

export type ToolCall = {
  toolCallId: string;
  toolName: string;
  args: any;
};

export type ToolResult = ToolCall & {
  result: any;
};

// Extended Message that includes optional extended properties
export interface ExtendedMessage extends Message {
  parent_id?: string | null;
  children_ids?: string[];
  model?: string;
  reasoning?: string;
  reasoning_signature?: string;
  redacted_reasoning?: string;
  source?: any;
  data?: Record<string, any>;
  toolInvocations?: ToolInvocation[];
}
