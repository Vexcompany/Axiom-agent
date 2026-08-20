export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessageToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Gemini OpenAI-compat: must be echoed on the next turn for tool loops. */
  extra_content?: { google?: { thought_signature?: string }; [k: string]: unknown };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  tool_calls?: ChatMessageToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
  /** Pass-through for Gemini thought_signature (OpenAI-compat extra_content). */
  extra_content?: { google?: { thought_signature?: string }; [k: string]: unknown };
}

export interface ToolResult {
  call: ParsedToolCall;
  ok: boolean;
  output: string;
}

export type AIStreamChunk =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_calls"; calls: ParsedToolCall[] };

export interface StreamChatOptions {
  signal?: AbortSignal;
  tools?: ToolDefinition[];
  maxTokens?: number;
  timeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface AIProvider {
  name: string;
  streamChat(
    messages: ChatMessage[],
    options?: StreamChatOptions
  ): AsyncGenerator<AIStreamChunk, void, unknown>;
}

export class AIProviderError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 502, code?: string) {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
    this.code = code;
  }
}
