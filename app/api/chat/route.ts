export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Mock streaming chat endpoint.
 * Frontend-first: returns a realistic streamed reply without a real model.
 * Swap this for Groq / OpenRouter / multi-provider fallback later.
 */
export async function POST(req: Request): Promise<Response> {
  let userText = "";
  try {
    const body = (await req.json()) as {
      messages?: Array<{ role?: string; content?: string }>;
      model?: string;
    };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    userText = typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!userText) {
    return Response.json({ error: "Last message must be a non-empty user message." }, { status: 400 });
  }

  const reply = buildMockReply(userText);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const chunks = chunkText(reply, 12);
      for (const chunk of chunks) {
        if (req.signal.aborted) break;
        controller.enqueue(encoder.encode(chunk));
        await sleep(18 + Math.floor(Math.random() * 22));
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

function buildMockReply(userText: string): string {
  const preview =
    userText.length > 120 ? userText.slice(0, 117) + "…" : userText;

  return [
    "**Axiom** (mock backend)",
    "",
    "Frontend is live. This reply is streamed from a placeholder API — no real model is connected yet.",
    "",
    `You said:`,
    "",
    `> ${preview}`,
    "",
    "### Next wiring steps",
    "1. Connect **Groq** or **OpenRouter** free models",
    "2. Add a provider **fallback chain**",
    "3. Optionally enable tools (GitHub, etc.)",
    "",
    "Until then, use this UI to polish layout, streaming, and chat history.",
  ].join("\n");
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
