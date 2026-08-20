import { likelyNeedsGitHub } from "./agent/needsTools";
import { runChat } from "./agent/runChat";
import type { ChatMessage as AgentMessage } from "./agent/types";
import { isGitHubConfigured } from "./github/auth";
import { GITHUB_TOOLS } from "./github/tools";
import { streamOpenAICompatible } from "./providers/openaiCompatible";
import { WorkerAIProvider } from "./providers/toolStream";
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
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_BASE_URL?: string;
  GITHUB_APP_ID?: string;
  GITHUB_PRIVATE_KEY?: string;
  GITHUB_BOT_NAME?: string;
  GITHUB_BOT_EMAIL?: string;
  GITHUB_API_BASE_URL?: string;
  AXIOM_MAX_TOKENS?: string;
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_GROQ = "https://api.groq.com/openai/v1";
const DEFAULT_OPENROUTER = "https://openrouter.ai/api/v1";
const DEFAULT_CEREBRAS = "https://api.cerebras.ai/v1";
const DEFAULT_GEMINI =
  "https://generativelanguage.googleapis.com/v1beta/openai";
const GROQ_DEFAULT_LIGHT = "openai/gpt-oss-20b";
const GROQ_DEFAULT_HEAVY = "openai/gpt-oss-120b";

/** Upstream Gemini model — 2.5-flash no longer available to new users. */
const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

function injectGitHubEnv(env: Env): void {
  const g = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  if (!g.process) {
    (g as { process: { env: Record<string, string | undefined> } }).process = {
      env: {},
    };
  }
  if (!g.process.env) g.process.env = {};
  const pe = g.process.env;
  if (env.GITHUB_APP_ID) pe.GITHUB_APP_ID = env.GITHUB_APP_ID;
  if (env.GITHUB_PRIVATE_KEY) pe.GITHUB_PRIVATE_KEY = env.GITHUB_PRIVATE_KEY;
  if (env.GITHUB_BOT_NAME) pe.GITHUB_BOT_NAME = env.GITHUB_BOT_NAME;
  if (env.GITHUB_BOT_EMAIL) pe.GITHUB_BOT_EMAIL = env.GITHUB_BOT_EMAIL;
  if (env.GITHUB_API_BASE_URL) pe.GITHUB_API_BASE_URL = env.GITHUB_API_BASE_URL;
}

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
): { config: ProviderConfig; resolvedModel: string; name: string } | null {
  const lower = model.toLowerCase();
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;

  if (
    geminiKey &&
    (lower.startsWith("gemini/") ||
      lower.includes("gemini-3.5-flash-lite") ||
      lower.includes("gemini-2.5") ||
      lower === "gemini-2.5-flash" ||
      lower === "gemini-3.5-flash-lite")
  ) {
    return {
      name: "Google Gemini",
      config: {
        id: "google",
        baseUrl: env.GEMINI_BASE_URL || DEFAULT_GEMINI,
        apiKey: geminiKey,
      },
      resolvedModel: GEMINI_DEFAULT_MODEL,
    };
  }

  if (lower.startsWith("groq/") && env.GROQ_API_KEY) {
    return {
      name: "Groq",
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
      name: "OpenRouter",
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
      name: "Cerebras",
      config: {
        id: "cerebras",
        baseUrl: env.CEREBRAS_BASE_URL || DEFAULT_CEREBRAS,
        apiKey: env.CEREBRAS_API_KEY,
      },
      resolvedModel: model.slice("cerebras/".length),
    };
  }

  if (geminiKey && lower === "auto") {
    return {
      name: "Google Gemini",
      config: {
        id: "google",
        baseUrl: env.GEMINI_BASE_URL || DEFAULT_GEMINI,
        apiKey: geminiKey,
      },
      resolvedModel: GEMINI_DEFAULT_MODEL,
    };
  }

  if (env.GROQ_API_KEY) {
    return {
      name: "Groq",
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
      name: "OpenRouter",
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
        lower === "auto"
          ? "openrouter/free"
          : model.replace(/^openrouter\//i, ""),
    };
  }

  if (geminiKey) {
    return {
      name: "Google Gemini",
      config: {
        id: "google",
        baseUrl: env.GEMINI_BASE_URL || DEFAULT_GEMINI,
        apiKey: geminiKey,
      },
      resolvedModel: GEMINI_DEFAULT_MODEL,
    };
  }

  return null;
}

function validateMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: string }).role;
    const content = (m as { content?: string }).content;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    if (typeof content !== "string") continue;
    out.push({ role, content });
  }
  return out.length > 0 ? out : null;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env),
      });
    }

    if (url.pathname !== "/chat" && url.pathname !== "/") {
      return jsonError(404, "Not found. POST /chat", origin, env);
    }

    if (request.method !== "POST") {
      return jsonError(405, "Method not allowed. Use POST.", origin, env);
    }

    injectGitHubEnv(env);

    let body: {
      model?: string;
      messages?: unknown;
      enableGitHubTools?: boolean;
      temperature?: number;
      max_tokens?: number;
    };
    try {
      body = (await request.json()) as typeof body;
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

    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : "auto";

    const resolved = resolveProvider(model, env);
    if (!resolved) {
      return jsonError(
        503,
        "No provider configured. Set GEMINI_API_KEY or GROQ_API_KEY on the Worker.",
        origin,
        env
      );
    }

    const toolsEnabled = body.enableGitHubTools === true;
    const toolsWanted =
      toolsEnabled && isGitHubConfigured() && likelyNeedsGitHub(messages);

    const maxTokens =
      typeof body.max_tokens === "number" && body.max_tokens > 0
        ? body.max_tokens
        : env.AXIOM_MAX_TOKENS
          ? parseInt(env.AXIOM_MAX_TOKENS, 10) || undefined
          : undefined;

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    if (toolsWanted) {
      const provider = new WorkerAIProvider(
        resolved.name,
        resolved.config,
        resolved.resolvedModel
      );
      const agentMessages: AgentMessage[] = messages.map((m) => ({
        role: m.role as AgentMessage["role"],
        content: m.content,
      }));

      ctx.waitUntil(
        (async () => {
          try {
            for await (const ev of runChat(
              provider,
              agentMessages,
              GITHUB_TOOLS,
              { signal: request.signal, maxToolRounds: 8, maxToolCalls: 24 }
            )) {
              if (ev.type === "text") {
                await writer.write(encoder.encode(ev.text));
              } else if (ev.type === "tool") {
                const mark = ev.ok ? "✓" : "✗";
                let line = `\n\n_🔧 \`${ev.tool}\` ${mark}_`;
                if (!ev.ok && "detail" in ev && ev.detail) {
                  const d = String(ev.detail).replace(/\s+/g, " ").slice(0, 280);
                  line += `\n\n\`\`\`\n${d}\n\`\`\``;
                }
                line += `\n\n`;
                await writer.write(encoder.encode(line));
              }
            }
            await writer.close();
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
              try {
                await writer.close();
              } catch {
                /* ignore */
              }
              return;
            }
            const msg =
              err instanceof Error && err.message ? err.message : "Agent error.";
            try {
              await writer.write(encoder.encode(`\n\n_(${msg})_`));
              await writer.close();
            } catch {
              /* ignore */
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
    }

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

    const temperature =
      typeof body.temperature === "number" ? body.temperature : undefined;

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
              /* ignore */
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
            /* ignore */
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
