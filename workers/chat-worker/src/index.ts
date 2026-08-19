import { streamOpenAICompatible } from "./providers/openaiCompatible";
import type { ChatMessage, ProviderConfig } from "./providers/types";
import { ProviderError } from "./providers/types";

export interface Env {
  GROQ_API_KEY?: string;
  GROQ_BASE_URL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  CEREBRAS_API_KEY?: string;
  CEREBRAS_BASE_URL?: string;
  SEKAI_API_KEY?: string;
  SEKAI_BASE_URL?: string;
  AXIOM_MAX_TOKENS?: string;
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_GROQ = "https://api.groq.com/openai/v1";
const DEFAULT_OPENROUTER = "https://openrouter.ai/api/v1";
const DEFAULT_CEREBRAS = "https://api.cerebras.ai/v1";

/** Groq model IDs after 2026-08-16 deprecations (Llama 3.1/3.3 shut down). */
const GROQ_DEFAULT_LIGHT = "openai/gpt-oss-20b";
const GROQ_DEFAULT_HEAVY = "openai/gpt-oss-120b";

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = (env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin =
    allowed.includes("*") || (origin && allowed.includes(origin))
      ? origin || "*"
      : allowed[0] || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonError(
  status: number,
  message: string,
  origin: string | null,
  env: Env
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, env),
    },
  });
}

/** Map UI / legacy ids → upstream Groq model id. */
function resolveGroqUpstream(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/^groq\//, "");
  const map: Record<string, string> = {
    auto: GROQ_DEFAULT_LIGHT,
    "llama-3.1-8b-instant": GROQ_DEFAULT_LIGHT,
    "llama-3.3-70b-versatile": GROQ_DEFAULT_HEAVY,
    "openai-gpt-oss-20b": GROQ_DEFAULT_LIGHT,
    "openai-gpt-oss-120b": GROQ_DEFAULT_HEAVY,
    "openai/gpt-oss-20b": GROQ_DEFAULT_LIGHT,
    "openai/gpt-oss-120b": GROQ_DEFAULT_HEAVY,
    "gpt-oss-20b": GROQ_DEFAULT_LIGHT,
    "gpt-oss-120b": GROQ_DEFAULT_HEAVY,
    "qwen3.6-27b": "qwen/qwen3.6-27b",
    "qwen/qwen3.6-27b": "qwen/qwen3.6-27b",
  };
  if (map[key]) return map[key];
  if (key.includes("/")) return key;
  return GROQ_DEFAULT_LIGHT;
}

function resolveProvider(
  model: string,
  env: Env
): { config: ProviderConfig; resolvedModel: string } | null {
  const lower = model.toLowerCase();

  if (lower.startsWith("groq/") && env.GROQ_API_KEY) {
    return {
      config: {
        id: "groq",
        baseUrl: env.GROQ_BASE_URL || DEFAULT_GROQ,
        apiKey: env.GROQ_API_KEY,
      },
      resolvedModel: resolveGroqUpstream(model),
    };
  }

  if (lower.startsWith("openrouter/") && env.OPENROUTER_API_KEY) {
    return {
      config: {
        id: "openrouter",
        baseUrl: env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER,
        apiKey: env.OPENROUTER_API_KEY,
        extraHeaders: {
          "HTTP-Referer": "https://axiom-ai.rv",
          "X-Title": "Axiom AI RV",
        },
      },
      resolvedModel: model.slice("openrouter/".length),
    };
  }

  if (lower.startsWith("cerebras/") && env.CEREBRAS_API_KEY) {
    return {
      config: {
        id: "cerebras",
        baseUrl: env.CEREBRAS_BASE_URL || DEFAULT_CEREBRAS,
        apiKey: env.CEREBRAS_API_KEY,
      },
      resolvedModel: model.slice("cerebras/".length),
    };
  }

  if (lower.startsWith("sekai/") && env.SEKAI_API_KEY && env.SEKAI_BASE_URL) {
    return {
      config: {
        id: "sekai",
        baseUrl: env.SEKAI_BASE_URL,
        apiKey: env.SEKAI_API_KEY,
      },
      resolvedModel: model.slice("sekai/".length),
    };
  }

  if (
    env.GROQ_API_KEY &&
    (lower === "auto" ||
      !lower.includes("/") ||
      lower.includes("llama") ||
      lower.includes("gpt-oss"))
  ) {
    return {
      config: {
        id: "groq",
        baseUrl: env.GROQ_BASE_URL || DEFAULT_GROQ,
        apiKey: env.GROQ_API_KEY,
      },
      resolvedModel: resolveGroqUpstream(model),
    };
  }

  if (env.OPENROUTER_API_KEY) {
    return {
      config: {
        id: "openrouter",
        baseUrl: env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER,
        apiKey: env.OPENROUTER_API_KEY,
        extraHeaders: {
          "HTTP-Referer": "https://axiom-ai.rv",
          "X-Title": "Axiom AI RV",
        },
      },
      resolvedModel:
        lower === "auto" ? "openrouter/free" : model.replace(/^openrouter\//i, ""),
    };
  }

  if (env.CEREBRAS_API_KEY) {
    return {
      config: {
        id: "cerebras",
        baseUrl: env.CEREBRAS_BASE_URL || DEFAULT_CEREBRAS,
        apiKey: env.CEREBRAS_API_KEY,
      },
      resolvedModel:
        lower === "auto" ? "gemma-4-31b" : model.replace(/^cerebras\//i, ""),
    };
  }

  return null;
}

function validateMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as any).role;
    const content = (m as any).content;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    if (typeof content !== "string") continue;
    out.push({ role, content });
  }
  return out.length > 0 ? out : null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env),
      });
    }

    if (request.method !== "POST") {
      return jsonError(405, "Method not allowed. Use POST /chat", origin, env);
    }

    if (
      url.pathname !== "/chat" &&
      url.pathname !== "/" &&
      url.pathname !== "/v1/chat/completions"
    ) {
      return jsonError(404, "Not found. Use POST /chat", origin, env);
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "Invalid JSON body.", origin, env);
    }

    const messages = validateMessages(body.messages);
    if (!messages) {
      return jsonError(
        400,
        "messages must be a non-empty array of {role, content}.",
        origin,
        env
      );
    }

    const last = messages[messages.length - 1];
    if (last.role !== "user" || !last.content.trim()) {
      return jsonError(
        400,
        "Last message must be a non-empty user message.",
        origin,
        env
      );
    }

    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : "auto";

    const resolved = resolveProvider(model, env);
    if (!resolved) {
      return jsonError(
        503,
        "No AI provider configured. Set GROQ_API_KEY (recommended) or OPENROUTER_API_KEY via Worker secrets.",
        origin,
        env
      );
    }

    const maxTokens =
      typeof body.max_tokens === "number" && body.max_tokens > 0
        ? body.max_tokens
        : env.AXIOM_MAX_TOKENS
          ? parseInt(env.AXIOM_MAX_TOKENS, 10) || undefined
          : undefined;

    const temperature =
      typeof body.temperature === "number" ? body.temperature : undefined;

    const hasSystem = messages.some((m) => m.role === "system");
    const finalMessages = hasSystem
      ? messages
      : [
          {
            role: "system" as const,
            content:
              "You are Axiom AI RV, co-builder with the Axiom developer. Match the language of the latest user message. Be direct and use Markdown when helpful.",
          },
          ...messages,
        ];

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    ctx.waitUntil(
      (async () => {
        try {
          for await (const chunk of streamOpenAICompatible({
            config: resolved.config,
            model: resolved.resolvedModel,
            messages: finalMessages,
            maxTokens,
            temperature,
            signal: request.signal,
          })) {
            await writer.write(encoder.encode(chunk));
          }
          await writer.close();
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            try {
              await writer.close();
            } catch {
              /* already closed */
            }
            return;
          }
          const msg =
            err instanceof ProviderError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Upstream provider error.";
          try {
            await writer.write(encoder.encode(`\n\n_(${msg})_`));
            await writer.close();
          } catch {
            /* stream already closed */
          }
        }
      })()
    );

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        ...corsHeaders(origin, env),
      },
    });
  },
};
