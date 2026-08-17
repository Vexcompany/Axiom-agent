/**
 * Minimal OpenAI-compatible client for the Sekai gateway.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class SekaiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 502, code?: string) {
    super(message);
    this.name = "SekaiError";
    this.status = status;
    this.code = code;
  }
}

export function isSekaiConfigured(): boolean {
  return Boolean(process.env.SEKAI_API_KEY && process.env.SEKAI_BASE_URL);
}

function baseUrl(): string {
  const raw = process.env.SEKAI_BASE_URL?.trim();
  if (!raw) {
    throw new SekaiError("SEKAI_BASE_URL is not configured.", 503, "config");
  }
  return raw.replace(/\/+$/, "");
}

function apiKey(): string {
  const key = process.env.SEKAI_API_KEY?.trim();
  if (!key) {
    throw new SekaiError("SEKAI_API_KEY is not configured.", 503, "config");
  }
  return key;
}

/**
 * Stream chat completions from Sekai. Yields plain text deltas only.
 */
export async function* streamSekaiChat(
  model: string,
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal; maxTokens?: number }
): AsyncGenerator<string, void, unknown> {
  const url = `${baseUrl()}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (opts?.maxTokens && opts.maxTokens > 0) {
    body.max_tokens = opts.maxTokens;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    throw new SekaiError("Could not reach the Sekai gateway.", 502, "network");
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      throw new SekaiError(
        "Sekai rejected the server credentials.",
        502,
        "auth"
      );
    }
    if (res.status === 429) {
      throw new SekaiError(
        "Sekai is rate-limiting requests. Try another model or wait.",
        429,
        "rate_limited"
      );
    }
    throw new SekaiError(
      `Sekai returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      502,
      "provider"
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
        if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) {
          continue;
        }
        let data = trimmed.startsWith("data:")
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
          /* skip malformed SSE lines */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
