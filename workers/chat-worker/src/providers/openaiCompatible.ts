import type { ChatMessage, ProviderConfig } from "./types";
import { ProviderError } from "./types";

export interface StreamOptions {
  config: ProviderConfig;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Streams text deltas from an OpenAI-compatible /chat/completions endpoint.
 * Yields raw content strings incrementally. Does not buffer the full response.
 */
export async function* streamOpenAICompatible(
  opts: StreamOptions
): AsyncGenerator<string, void, unknown> {
  const base = opts.config.baseUrl.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
  };
  if (opts.maxTokens && opts.maxTokens > 0) {
    body.max_tokens = opts.maxTokens;
  }
  if (typeof opts.temperature === "number") {
    body.temperature = opts.temperature;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.config.apiKey}`,
        ...opts.config.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    throw new ProviderError(
      `Could not reach ${opts.config.id}.`,
      502,
      "network",
      opts.config.id
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        `${opts.config.id} rejected credentials.`,
        502,
        "auth",
        opts.config.id
      );
    }
    if (res.status === 429) {
      throw new ProviderError(
        `${opts.config.id} rate-limited. Try another model/provider.`,
        429,
        "rate_limited",
        opts.config.id
      );
    }
    throw new ProviderError(
      `${opts.config.id} HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      502,
      "provider",
      opts.config.id
    );
  }

  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        const data = trimmed.startsWith("data:")
          ? trimmed.slice(5).trim()
          : trimmed;
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: unknown } }>;
          };
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) {
            yield content;
          }
        } catch {
          /* skip malformed SSE chunk */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
