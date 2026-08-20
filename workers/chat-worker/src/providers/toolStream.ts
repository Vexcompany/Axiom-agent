import type {
  AIProvider,
  AIStreamChunk,
  ChatMessage,
  ParsedToolCall,
  StreamChatOptions,
} from "../agent/types";
import type { ProviderConfig } from "./types";
import { ProviderError } from "./types";

export class WorkerAIProvider implements AIProvider {
  name: string;
  private config: ProviderConfig;
  private model: string;

  constructor(name: string, config: ProviderConfig, model: string) {
    this.name = name;
    this.config = config;
    this.model = model;
  }

  async *streamChat(
    messages: ChatMessage[],
    options?: StreamChatOptions
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
    };
    if (options?.tools && options.tools.length > 0) body.tools = options.tools;
    if (options?.maxTokens && options.maxTokens > 0) body.max_tokens = options.maxTokens;

    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          ...this.config.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      throw new ProviderError(`Could not reach ${this.name}.`, 502, "network");
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 280);
      } catch {
        /* ignore */
      }
      if (res.status === 429) {
        throw new ProviderError(`${this.name} rate-limited.`, 429, "rate_limited");
      }
      throw new ProviderError(
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
          const delta = (
            parsed as { choices?: Array<{ delta?: { content?: string | null } }> }
          )?.choices?.[0]?.delta;
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
  get size() {
    return this.map.size;
  }
  merge(parsed: unknown): boolean {
    const raw = (
      parsed as { choices?: Array<{ delta?: { tool_calls?: unknown } }> }
    )?.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(raw) || raw.length === 0) return false;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const c = item as {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      };
      const i = typeof c.index === "number" ? c.index : 0;
      const prev = this.map.get(i) ?? { id: "", name: "", arguments: "" };
      if (typeof c.id === "string" && c.id) prev.id = c.id;
      if (typeof c.function?.name === "string" && c.function.name) prev.name = c.function.name;
      if (typeof c.function?.arguments === "string") prev.arguments += c.function.arguments;
      this.map.set(i, prev);
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
