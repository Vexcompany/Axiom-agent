# Axiom AI RV (v2)

Multi-provider AI agent chat. System prompt identity: **Axiom AI RV** (from Raphael-agent).

## Architecture (chat streaming)

```
Browser
  → POST /api/chat          (Next.js, server-only)
  → CHAT_WORKER_URL         (Cloudflare Worker)
  → Groq / OpenRouter / …   (API keys live only on the Worker)
  → incremental text stream
  → Browser
```

- Provider API keys **never** reach the browser or Vercel env (unless you intentionally fall back).
- Worker URL is **server-only** (`CHAT_WORKER_URL`, not `NEXT_PUBLIC_`).
- Streaming is piped through without buffering the full reply.

## Setup

### 1. Cloudflare Worker secrets

```bash
cd workers/chat-worker
npm install
npx wrangler secret put GROQ_API_KEY          # recommended
# optional:
# npx wrangler secret put OPENROUTER_API_KEY
# npx wrangler secret put CEREBRAS_API_KEY
npx wrangler deploy
```

Worker endpoint example:
`https://axiom-agent.vexcorporation43.workers.dev/chat`

### 2. Next.js app

```bash
npm install
cp .env.example .env.local
```

In `.env.local` (and Vercel env):

```bash
# Server-only — points Next /api/chat at the Worker
CHAT_WORKER_URL=https://axiom-agent.vexcorporation43.workers.dev/chat
```

Do **not** put Groq/OpenRouter keys in Next/Vercel if the Worker is configured.

```bash
npm run dev
```

Frontend keeps calling `/api/chat`; the route proxies to the Worker when `CHAT_WORKER_URL` is set.

### 3. Quick test Worker alone

```bash
curl -N -X POST https://axiom-agent.vexcorporation43.workers.dev/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Halo, jawab singkat."}]}'
```

## Fallback (no Worker)

If `CHAT_WORKER_URL` is unset, `/api/chat` talks to providers directly using:

```bash
GROQ_API_KEY=
OPENROUTER_API_KEY=
CEREBRAS_API_KEY=
SEKAI_BASE_URL=
SEKAI_API_KEY=
# AXIOM_MAX_TOKENS=2048
```

## Why not NVIDIA NIM by default?

On **Vercel**, outbound requests share platform egress IPs. Providers that rate-limit by IP (common on NIM free tiers) will block you even if *you* barely chat — because many other apps share the same IP pool.

**Prefer key-based free tiers:**

| Priority | Provider | Light model (Auto first) |
|----------|----------|---------------------------|
| 1 | **Groq** | `llama-3.1-8b-instant` |
| 2 | **OpenRouter** | `meta-llama/llama-3.2-3b-instruct:free` |
| 3 | **Cerebras** | `llama3.1-8b` |
| 4 | **Sekai** | `free/gpt-5.6-luna` |

## Stack

- Next.js 14 + React + TypeScript (UI + thin `/api/chat` proxy)
- Cloudflare Worker (`workers/chat-worker`) for streaming + provider keys
- Local chat sessions in the browser
- System prompt: Axiom AI RV

See [workers/chat-worker/README.md](workers/chat-worker/README.md) for Worker details.
