import {
  anyRealProviderConfigured,
  streamWithFallback,
} from "@/lib/providers/router";
import { ProviderError } from "@/lib/providers/types";
import type { ChatMessage } from "@/lib/providers/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Prefix so the client can stick Auto to the same model across turns. */
const META_PREFIX = "%%%META:";

export async function POST(req: Request): Promise<Response> {
  let messages: ChatMessage[] = [];
  let requestedModel = "auto";
  let preferredModel: string | undefined;

  try {
    const body = (await req.json()) as {
      messages?: Array<{ role?: string; content?: string }>;
      model?: string;
      preferredModel?: string;
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
      ? "Set GROQ_API_KEY and/or OPENROUTER_API_KEY (recommended), then redeploy."
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
