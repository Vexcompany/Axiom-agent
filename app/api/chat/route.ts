import {
  autoFallbackChain,
  DEFAULT_SEKAI_MODEL,
  findModel,
  isKnownModel,
} from "@/lib/sekai/models";
import {
  isSekaiConfigured,
  SekaiError,
  streamSekaiChat,
  type ChatMessage,
} from "@/lib/sekai/client";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM_PROMPT =
  "You are Axiom, a helpful AI agent. Be clear, direct, and concise. Use Markdown when it helps.";

export async function POST(req: Request): Promise<Response> {
  let messages: ChatMessage[] = [];
  let requestedModel = "auto";

  try {
    const body = (await req.json()) as {
      messages?: Array<{ role?: string; content?: string }>;
      model?: string;
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

  // Mock path when gateway is not configured or user explicitly picks mock.
  if (requestedModel === "mock" || !isSekaiConfigured()) {
    return mockStream(last.content, req.signal, !isSekaiConfigured());
  }

  const chain =
    requestedModel === "auto"
      ? autoFallbackChain()
      : isKnownModel(requestedModel)
        ? [requestedModel]
        : [DEFAULT_SEKAI_MODEL];

  const conversation: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.slice(-40),
  ];

  const maxTokens = positiveInt(process.env.SEKAI_MAX_TOKENS, 4096);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastErr: string | null = null;

      for (const modelId of chain) {
        if (req.signal.aborted) break;
        try {
          let produced = false;
          for await (const chunk of streamSekaiChat(modelId, conversation, {
            signal: req.signal,
            maxTokens,
          })) {
            produced = true;
            controller.enqueue(encoder.encode(chunk));
          }
          if (produced) {
            controller.close();
            return;
          }
          lastErr = `Model ${modelId} returned an empty response.`;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            controller.close();
            return;
          }
          const msg =
            err instanceof SekaiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Upstream error";
          lastErr = `${findModel(modelId)?.label ?? modelId}: ${msg}`;
          // Auth errors: stop the chain (key is wrong for all models).
          if (err instanceof SekaiError && err.code === "auth") {
            break;
          }
          // Otherwise try next model in the auto chain.
          continue;
        }
      }

      const safe =
        lastErr ??
        "All Sekai models failed. Try again or switch model.";
      try {
        controller.enqueue(encoder.encode(`\n\n_(${safe})_`));
        controller.close();
      } catch {
        /* closed */
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

function mockStream(
  userText: string,
  signal: AbortSignal,
  missingConfig: boolean
): Response {
  const preview =
    userText.length > 120 ? userText.slice(0, 117) + "…" : userText;
  const reply = [
    "**Axiom** " + (missingConfig ? "(Sekai not configured)" : "(mock)"),
    "",
    missingConfig
      ? "Set `SEKAI_BASE_URL` and `SEKAI_API_KEY` in the environment, then redeploy."
      : "Mock stream is active.",
    "",
    `You said:`,
    "",
    `> ${preview}`,
    "",
    "### Sekai free models",
    "- `free/gpt-5.6-luna` — online · 400K",
    "- `gcli/grok-4.6` — online · 256K",
    "- `jb/sekai-flash` — online · 1M",
    "- `free/grok-4.5` / `free/grok-4.6` — offline (upstream timeout)",
  ].join("\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < reply.length; i += 14) {
        if (signal.aborted) break;
        controller.enqueue(encoder.encode(reply.slice(i, i + 14)));
        await new Promise((r) => setTimeout(r, 16));
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

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
