# Axiom AI RV (v2)

Multi-provider AI agent chat. System prompt identity: **Axiom AI RV** (from Raphael-agent).

## Why not NVIDIA NIM by default?

On **Vercel**, outbound requests share platform egress IPs. Providers that rate-limit by IP (common on NIM free tiers) will block you even if *you* barely chat — because many other apps share the same IP pool.

**Prefer key-based free tiers:**

| Priority | Provider | Light model (Auto first) |
|----------|----------|---------------------------|
| 1 | **Groq** | `llama-3.1-8b-instant` |
| 2 | **OpenRouter** | `meta-llama/llama-3.2-3b-instruct:free` |
| 3 | **Cerebras** | `llama3.1-8b` |
| 4 | **Sekai** | `free/gpt-5.6-luna` |

Auto tries **light** models first, then stronger ones, only for providers whose API keys are set.

## Setup

```bash
npm install
cp .env.example .env.local
# set GROQ_API_KEY (recommended) and/or OPENROUTER_API_KEY
npm run dev
```

## Env

```bash
GROQ_API_KEY=
OPENROUTER_API_KEY=
CEREBRAS_API_KEY=
SEKAI_BASE_URL=
SEKAI_API_KEY=
# AXIOM_MAX_TOKENS=2048
```

## Stack

- Next.js 14 + React + TypeScript
- Streaming OpenAI-compatible providers
- Local chat sessions in the browser
- System prompt: Axiom AI RV (GitHub tools not wired yet)
