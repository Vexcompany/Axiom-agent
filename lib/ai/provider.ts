import {
  AIProvider,
  AIProviderError,
  AIStreamChunk,
  ChatMessage,
  ParsedToolCall,
  StreamChatOptions,
} from "./types";

export class OpenAICompatibleProvider implements AIProvider {
  name: string;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private extraHeaders: Record<string, string>;

  constructor(opts: {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    extraHeaders?: Record<string, string>;
  }) {
    this.name = opts.name;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  async *streamChat(
    messages: ChatMessage[],
    options?: StreamChatOptions
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
    };
    if (options?.tools && options.tools.length > 0) body.tools = options.tools;
    if (options?.maxTokens && options.maxTokens > 0) body.max_tokens = options.maxTokens;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      throw new AIProviderError(`Could not reach ${this.name}.`, 502, "network");
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 280);
      } catch {
        /* ignore */
      }
      if (res.status === 401 || res.status === 403) {
        throw new AIProviderError(`${this.name} rejected credentials.`, 502, "auth");
      }
      if (res.status === 429) {
        throw new AIProviderError(
          `${this.name} rate-limited. Gemini free tier is ~15 req/min / 1500/day.`,
          429,
          "rate_limited"
        );
      }
      throw new AIProviderError(
        `${this.name} HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        502,
        "provider"
      );
    }

    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls = new ToolCallAccumulator();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          const delta = (parsed as { choices?: Array<{ delta?: { content?: string | null } }> })?.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.content === "string" && delta.content) {
            yield { type: "text", text: delta.content };
          }
          toolCalls.merge(parsed);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    if (toolCalls.size > 0) {
      yield { type: "tool_calls", calls: toolCalls.toArray() };
    }
  }
}

class ToolCallAccumulator {
  private map = new Map<number, { id: string; name: string; arguments: string }>();
  get size(): number {
    return this.map.size;
  }
  merge(parsed: unknown): boolean {
    const rawCalls = (
      parsed as { choices?: Array<{ delta?: { tool_calls?: unknown } }> }
    )?.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(rawCalls) || rawCalls.length === 0) return false;
    for (const raw of rawCalls) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      };
      const index = typeof item.index === "number" ? item.index : 0;
      const prev = this.map.get(index) ?? { id: "", name: "", arguments: "" };
      if (typeof item.id === "string" && item.id) prev.id = item.id;
      if (typeof item.function?.name === "string" && item.function.name) prev.name = item.function.name;
      if (typeof item.function?.arguments === "string") prev.arguments += item.function.arguments;
      this.map.set(index, prev);
    }
    return true;
  }
  toArray(): ParsedToolCall[] {
    const out: ParsedToolCall[] = [];
    for (const i of [...this.map.keys()].sort((a, b) => a - b)) {
      const c = this.map.get(i)!;
      if (!c.name) continue;
      let args: Record<string, unknown> = {};
      try {
        const v = JSON.parse(c.arguments || "{}");
        if (v && typeof v === "object" && !Array.isArray(v)) args = v as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      out.push({
        id: c.id || `call_${i}`,
        name: c.name,
        arguments: args,
        rawArguments: c.arguments || "{}",
      });
    }
    return out;
  }
}

export function resolveAgentProvider(modelId: string): OpenAICompatibleProvider | null {
  const id = modelId.toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (geminiKey && (id.startsWith("gemini/") || id.includes("gemini-2.5") || id === "gemini-2.5-flash")) {
    return new OpenAICompatibleProvider({
      name: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: geminiKey,
      model: "gemini-2.5-flash",
    });
  }

  if (process.env.GROQ_API_KEY && (id.startsWith("groq/") || id === "auto" || id.includes("gpt-oss"))) {
    let upstream = "openai/gpt-oss-20b";
    if (id.includes("120b")) upstream = "openai/gpt-oss-120b";
    else if (id.includes("qwen")) upstream = "qwen/qwen3.6-27b";
    return new OpenAICompatibleProvider({
      name: "Groq",
      baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      model: upstream,
    });
  }

  if (process.env.OPENROUTER_API_KEY && (id.startsWith("openrouter/") || id === "auto")) {
    return new OpenAICompatibleProvider({
      name: "OpenRouter",
      baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: id.startsWith("openrouter/") ? id.slice("openrouter/".length) : "openrouter/free",
      extraHeaders: {
        "HTTP-Referer": "https://axiom-ai.rv",
        "X-Title": "Axiom AI RV",
      },
    });
  }

  if (geminiKey && id === "auto") {
    return new OpenAICompatibleProvider({
      name: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: geminiKey,
      model: "gemini-2.5-flash",
    });
  }

  if (process.env.GROQ_API_KEY) {
    return new OpenAICompatibleProvider({
      name: "Groq",
      baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      model: "openai/gpt-oss-20b",
    });
  }

  return null;
} 
