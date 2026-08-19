# Axiom Chat Streaming Worker

Minimal Cloudflare Worker that proxies OpenAI-compatible chat completions with true incremental streaming.

Architecture:

```
Frontend → POST /chat → this Worker → AI provider → stream chunks → Frontend
```

Chunks are forwarded as soon as they arrive. The Worker never waits for the full model response.

## Requirements

- Node.js 18+
- Cloudflare account (for deploy)
- At least one provider API key (Groq recommended)

## Install

```bash
cd workers/chat-worker
npm install
```

## Local development

```bash
# Set secrets for local (or use .dev.vars)
cp .dev.vars.example .dev.vars
# edit .dev.vars with your keys

npx wrangler dev
```

Worker will listen on `http://127.0.0.1:8787`.

## Environment / Secrets

**Secrets** (never commit, set with `wrangler secret put <NAME>`):

| Name | Required | Description |
|------|----------|-------------|
| `GROQ_API_KEY` | Recommended | Groq API key |
| `OPENROUTER_API_KEY` | Optional | OpenRouter key |
| `CEREBRAS_API_KEY` | Optional | Cerebras key |
| `SEKAI_API_KEY` | Optional | Sekai gateway key |

**Optional vars** (in `wrangler.toml` `[vars]` or dashboard):

| Name | Description |
|------|-------------|
| `GROQ_BASE_URL` | Default `https://api.groq.com/openai/v1` |
| `OPENROUTER_BASE_URL` | Default `https://openrouter.ai/api/v1` |
| `CEREBRAS_BASE_URL` | Default `https://api.cerebras.ai/v1` |
| `SEKAI_BASE_URL` | Required if using Sekai |
| `AXIOM_MAX_TOKENS` | Cap on `max_tokens` |
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS (default `*`) |

Set a secret:

```bash
npx wrangler secret put GROQ_API_KEY
```

## Endpoint

`POST /chat`

Also accepts `POST /` and `POST /v1/chat/completions` for convenience.

### Request body (OpenAI-style)

```json
{
  "model": "auto",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "max_tokens": 1024,
  "temperature": 0.7
}
```

- `model`: `"auto"` (picks first available light model), a plain model id, or prefixed (`groq/llama-3.1-8b-instant`, `openrouter/meta-llama/...`).
- `messages`: array of `{ role, content }` (`user` / `assistant` / `system`).

### Response

- `Content-Type: text/plain; charset=utf-8`
- Body is a continuous stream of text deltas (no SSE wrapper).
- Errors after stream start are appended as `_(message)_`.
- Pre-stream errors return JSON `{ "error": "..." }` with appropriate status.

### Example (curl)

```bash
curl -N -X POST http://127.0.0.1:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Say hi in one sentence."}]}'
```

`-N` disables buffering so you see chunks arrive live.

## Deploy

```bash
npx wrangler deploy
```

Then set secrets in the Cloudflare dashboard or via CLI.

## Platform notes

- Cloudflare Workers support long-lived streaming connections.
- There is no artificial short timeout in this code.
- Platform limits (CPU time, request duration) still apply; see Cloudflare docs for current Workers limits. Streaming keeps the connection open while data is flowing.
- Secrets are never exposed to the client.

## Provider abstraction

Providers live under `src/providers/`. The first implementation is OpenAI-compatible streaming (`openaiCompatible.ts`). Adding another provider only requires a new adapter and a few lines in `resolveProvider`.

## Security

- API keys stay in Worker secrets.
- Request validation rejects malformed bodies.
- No arbitrary URL proxying.
- CORS controlled via `ALLOWED_ORIGINS`.
