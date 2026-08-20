import { runChat } from "@/lib/agent/runChat";
import { likelyNeedsGitHub } from "@/lib/agent/needsTools";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import type { ChatMessage as AgentMessage } from "@/lib/ai/types";
import { resolveAgentProvider } from "@/lib/ai/provider";
import { isGitHubConfigured } from "@/lib/github/auth";
import { GITHUB_TOOLS } from "@/lib/github/tools";
import {
  anyRealProviderConfigured,
  streamWithFallback,
} from "@/lib/providers/router";
import type { ChatMessage } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface IncomingMessage {
  role?: string;
  content?: string;
}

interface ChatBody {
  model?: string;
  messages?: IncomingMessage[];
  preferredModel?: string;
  memorySummary?: string;
}

function normalizeMessages(raw: IncomingMessage[] | undefined): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = m.role;
    const content = m.content;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    if (typeof content !== "string") continue;
    out.push({ role, content });
  }
  return out;
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = normalizeMessages(body.messages);
  if (messages.length === 0) {
    return Response.json(
      { error: "messages must be a non-empty array of {role, content}." },
      { status: 400 }
    );
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user" || !last.content.trim()) {
    return Response.json(
      { error: "Last message must be a non-empty user message." },
      { status: 400 }
    );
  }

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "auto";

  const signal = req.signal;
  const githubConnected = isGitHubConfigured();
  const toolsWanted = githubConnected && likelyNeedsGitHub(messages);

  if (toolsWanted) {
    const provider = resolveAgentProvider(model);
    if (!provider) {
      return Response.json(
        {
          error:
            "GitHub tools need GEMINI_API_KEY (recommended) or GROQ_API_KEY / OPENROUTER_API_KEY.",
        },
        { status: 503 }
      );
    }

    const system = buildSystemPrompt({
      githubConnected: true,
      toolsActive: true,
      memorySummary: body.memorySummary,
    });

    const agentMessages: AgentMessage[] = [
      { role: "system", content: system },
      ...messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const ev of runChat(provider, agentMessages, GITHUB_TOOLS, {
            signal,
            maxToolRounds: 8,
            maxToolCalls: 24,
          })) {
            if (signal.aborted) break;
            if (ev.type === "text") {
              controller.enqueue(encoder.encode(ev.text));
            } else if (ev.type === "tool") {
              const mark = ev.ok ? "✓" : "✗";
              controller.enqueue(
                encoder.encode(`\n\n_🔧 \`${ev.tool}\` ${mark}_\n\n`)
              );
            }
          }
        } catch (err) {
          if (!(err instanceof Error && err.name === "AbortError")) {
            const msg =
              err instanceof Error && err.message ? err.message : "Agent error.";
            try {
              controller.enqueue(encoder.encode(`\n\n_(${msg})_`));
            } catch {
              /* closed */
            }
          }
        } finally {
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      },
      cancel() {},
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const workerUrl = process.env.CHAT_WORKER_URL?.replace(/\/+$/, "");
  if (workerUrl) {
    const system = buildSystemPrompt({
      githubConnected,
      toolsActive: false,
      memorySummary: body.memorySummary,
    });
    try {
      const upstream = await fetch(`${workerUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, ...messages],
          preferredModel: body.preferredModel,
          memorySummary: body.memorySummary,
        }),
        signal,
      });
      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          },
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return new Response(null, { status: 499 });
      }
    }
  }

  if (!anyRealProviderConfigured() && model !== "mock") {
    return Response.json(
      {
        error:
          "No provider configured. Set GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.",
      },
      { status: 503 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamWithFallback(model, messages, {
          signal,
          preferredModel: body.preferredModel,
          existingMemory: body.memorySummary,
        })) {
          if (signal.aborted) break;
          if (chunk.type === "meta") {
            controller.enqueue(encoder.encode(`%%%META:${chunk.modelId}\n`));
          } else if (chunk.type === "text") {
            controller.enqueue(encoder.encode(chunk.text));
          }
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          const msg =
            err instanceof Error && err.message ? err.message : "Upstream error.";
          try {
            controller.enqueue(encoder.encode(`\n\n_(${msg})_`));
          } catch {
            /* closed */
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
