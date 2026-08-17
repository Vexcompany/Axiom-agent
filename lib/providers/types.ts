export type ProviderId = "groq" | "openrouter" | "cerebras" | "sekai" | "mock";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CatalogModel {
  /** Unique id used by the client + router (may include provider prefix). */
  id: string;
  /** Exact model string sent to the upstream API. */
  upstreamModel: string;
  provider: ProviderId;
  label: string;
  tag: string;
  /** Prefer these in Auto: lighter load, key-based auth (less shared-IP pain). */
  light: boolean;
  /** Hint for UI. */
  note?: string;
}

export class ProviderError extends Error {
  status: number;
  code?: string;
  provider?: ProviderId;
  constructor(
    message: string,
    status = 502,
    code?: string,
    provider?: ProviderId
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
    this.provider = provider;
  }
}
