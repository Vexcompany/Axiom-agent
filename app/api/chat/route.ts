import { buildSystemPrompt } from "@/lib/ai/systemPrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Proxy only — long tool rounds run on Cloudflare Worker. */
export const maxDuration = 300;

interface IncomingMessage {
  role?: string;
  content?: string;
}

interface ChatBody {
  model?: string;
  messages?: IncomingMessage[];
  preferredModel?: string;
  memorySummary?: string;
  enableGitHubTools?: boolean;
}

function normalizeMessages(
  raw: IncomingMessage[] | undefined
): { role: "user" | "assistant" | "system"; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { role: "user" | "assistant" | "system"; content: string }[] = [];
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

/**
 * Thin proxy → Cloudflare chat-worker.
 * GitHub tools + long streams run on the Worker (not Vercel).
 */
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

  const toolsEnabled = body.enableGitHubTools === true;
  const system = buildSystemPrompt({
    githubConnected: toolsEnabled,
    toolsActive: toolsEnabled,
    memorySummary: body.memorySummary,
  });

  const workerUrl = process.env.CHAT_WORKER_URL?.replace(/\/+$/, "");
  if (!workerUrl) {
    return Response.json(
      {
        error:
          "CHAT_WORKER_URL is not set. Chat and GitHub tools run on the Cloudflare Worker.",
      },
      { status: 503 }
    );
  }

  try {
    const upstream = await fetch(`${workerUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        enableGitHubTools: toolsEnabled,
        preferredModel: body.preferredModel,
        messages: [{ role: "system", content: system }, ...messages],
      }),
      signal: req.signal,
    });

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
      return Response.json(
        { error: "Empty response from chat worker." },
        { status: 502 }
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
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
}
