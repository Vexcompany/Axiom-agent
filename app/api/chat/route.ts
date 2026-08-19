import {
  anyRealProviderConfigured,
  streamWithFallback,
} from "@/lib/providers/router";
import { ProviderError } from "@/lib/providers/types";
import type { ChatMessage } from "@/lib/providers/types";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";

export const runtime = "nodejs";
/** Hobby max is 300s with Fluid compute — stay under the ceiling. */
export const maxDuration = 290;

const META_PREFIX = "%%%META:";

/**
 * Server-only. Never use NEXT_PUBLIC_ here — the Worker URL must not ship to the browser.
 * Example: https://axiom-agent.vexcorporation43.workers.dev/chat
 */
const WORKER_URL = process.env.CHAT_WORKER_URL?.trim();

export async function POST(req: Request): Promise<Response> {
  let messages: ChatMessage[] = [];
  let requestedModel = "auto";
  let preferredModel: string | undefined;
  let existingMemory: string | undefined;
  let rawBody: unknown;

  try {
    rawBody = await req.json();
    const body = rawBody as {
      messages?: Array<{ role?: string; content?: string }>;
      model?: string;
      preferredModel?: string;
      memorySummary?: string;
    };
    const raw = Array.isArray(body.messages) ? body.messages : [];
    for (const m of raw) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (typeof m.content !== "string") continue;
      messages.push({ role: m.role, content: m.content });
    }
    if (typeof body.model === "string" && body.model.trim()) {
      requestedModel = body.model.trim();
    }
    if (typeof body.preferredModel === "string" && body.preferredModel.trim()) {
      preferredModel = body.preferredModel.trim();
    }
    if (typeof body.memorySummary === "string" && body.memorySummary.trim()) {
      existingMemory = body.memorySummary.trim();
    }
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) {
    return Response.json(
      { error: "Last message must be a non-empty user message." },
      { status: 400 }
    );
  }

  // Prefer Cloudflare Worker when configured (keys stay on the Worker).
  if (WORKER_URL && requestedModel !== "mock") {
    return proxyToWorker(WORKER_URL, {
      model: requestedModel,
      messages,
      preferredModel,
      memorySummary: existingMemory,
    }, req.signal);
  }

  if (requestedModel === "mock" || !anyRealProviderConfigured()) {
    return mockStream(last.content, req.signal, !anyRealProviderConfigured());
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamWithFallback(requestedModel, messages, {
          signal: req.signal,
          preferredModel:
            requestedModel === "auto" ? preferredModel : undefined,
          existingMemory,
        })) {
          if (event.type === "meta") {
            controller.enqueue(
              encoder.encode(`${META_PREFIX}${event.modelId}\n`)
            );
          } else {
            controller.enqueue(encoder.encode(event.text));
          }
        }
        controller.close();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          controller.close();
          return;
        }
        const safe =
          err instanceof ProviderError
            ? err.message
            : err instanceof Error
              ? err.message
              : "An unexpected error occurred.";
        try {
          controller.enqueue(encoder.encode(`\n\n_(${safe})_`));
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Stream proxy: browser → this route → Cloudflare Worker → AI provider.
 * Worker URL and provider keys never reach the client.
 * Injects Axiom system prompt so identity/language rules apply on the Worker path.
 */
async function proxyToWorker(
  workerUrl: string,
  payload: {
    model: string;
    messages: ChatMessage[];
    preferredModel?: string;
    memorySummary?: string;
  },
  signal: AbortSignal
): Promise<Response> {
  let upstream: Response;
  try {
    const system = buildSystemPrompt({
      githubConnected: false,
      toolsActive: false,
      memorySummary: payload.memorySummary,
    });
    const messagesWithSystem: ChatMessage[] = [
      { role: "system", content: system },
      ...payload.messages,
    ];

    upstream = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: payload.model,
        messages: messagesWithSystem,
        preferredModel: payload.preferredModel,
        memorySummary: payload.memorySummary,
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    return Response.json(
      { error: "Could not reach chat worker." },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    let message = `Chat worker error (${upstream.status})`;
    try {
      const data = (await upstream.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      try {
        const text = (await upstream.text()).slice(0, 300);
        if (text) message = text;
      } catch {
        /* ignore */
      }
    }
    return Response.json({ error: message }, { status: upstream.status });
  }

  if (!upstream.body) {
    return Response.json({ error: "Empty response from chat worker." }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

function mockStream(
  userText: string,
  signal: AbortSignal,
  missingConfig: boolean
): Response {
  const preview =
    userText.length > 120 ? userText.slice(0, 117) + "…" : userText;
  const reply = [
    "**Axiom AI RV** " +
      (missingConfig ? "(no provider keys configured)" : "(mock)"),
    "",
    missingConfig
      ? "Set GROQ_API_KEY and/or OPENROUTER_API_KEY, then redeploy."
      : "Mock stream is active.",
    "",
    `You said:`,
    "",
    `> ${preview}`,
  ].join("\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < reply.length; i += 14) {
        if (signal.aborted) break;
        controller.enqueue(encoder.encode(reply.slice(i, i + 14)));
        await new Promise((r) => setTimeout(r, 12));
      }
      controller.close();
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
