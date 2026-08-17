import type { ChatMessage, ProviderId } from "./types";
import { ProviderError } from "./types";

interface StreamOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  provider: ProviderId;
  signal?: AbortSignal;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
}

/**
 * Stream text deltas from an OpenAI-compatible /chat/completions endpoint.
 */
export async function* streamOpenAICompatible(
  opts: StreamOpts
): AsyncGenerator<string, void, unknown> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
  };
  if (opts.maxTokens && opts.maxTokens > 0) {
    body.max_tokens = opts.maxTokens;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        ...opts.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    throw new ProviderError(
      `Could not reach ${opts.provider}.`,
      502,
      "network",
      opts.provider
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        `${opts.provider} rejected credentials.`,
        502,
        "auth",
        opts.provider
      );
    }
    if (res.status === 429) {
      throw new ProviderError(
        `${opts.provider} rate-limited this key. Try another model/provider.`,
        429,
        "rate_limited",
        opts.provider
      );
    }
    throw new ProviderError(
      `${opts.provider} HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      502,
      "provider",
      opts.provider
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
          if (typeof content === "string" && content) yield content;
        } catch {
          /* skip bad SSE */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
