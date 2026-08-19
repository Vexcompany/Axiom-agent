export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ProviderConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number = 502,
    public code: string = "provider",
    public provider?: string
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
