# Axiom Agent

AI chat UI with **Sekai gateway** free models (OpenAI-compatible).

## Stack

- Next.js 14 (App Router) + React + TypeScript
- Sekai gateway streaming (`/v1/chat/completions` style)
- Local chat sessions in the browser

## Free models (catalog)

| Model id | Status (snapshot) | Notes |
|----------|-------------------|--------|
| `free/gpt-5.6-luna` | Online | Reasoning · 400K ctx |
| `gcli/grok-4.6` | Online | Reasoning · 256K ctx |
| `jb/sekai-flash` | Online | Uncensored · 1M ctx |
| `free/grok-4.5` | Offline | Upstream timeout |
| `free/grok-4.6` | Offline | Upstream timeout |

**Auto** tries online models first, then offline ones.

## Setup

```bash
npm install
cp .env.example .env.local
# fill SEKAI_BASE_URL and SEKAI_API_KEY
npm run dev
```

### Environment

```bash
SEKAI_BASE_URL=https://YOUR-SEKAI-HOST/v1
SEKAI_API_KEY=your-key
# optional
# SEKAI_MAX_TOKENS=4096
```

`SEKAI_BASE_URL` must **not** include `/chat/completions` — the app appends that path.

If env vars are missing, the app falls back to a **mock stream** so the UI still works.

## Scripts

```bash
npm run dev
npm run build
npm run start
```
