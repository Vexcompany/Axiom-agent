export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessageToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
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

export class ModelUnavailableError extends AIProviderError {
  model: string;
  constructor(model: string, message = "The selected model is currently unavailable.") {
    super(message, 409);
    this.name = "ModelUnavailableError";
    this.model = model;
  }
}
