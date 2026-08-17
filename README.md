# Axiom Agent

Frontend-first AI chat / agent UI. Backend is a **mock stream** for now so you can polish the product look before wiring real providers (Groq, OpenRouter, Cerebras, etc.).

## Stack

- Next.js 14 (App Router) + React + TypeScript
- Pure CSS (no Tailwind required)
- `react-markdown` + GFM for assistant replies

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What’s included (v0.1 UI)

- Sidebar with chat sessions (localStorage)
- Streaming message bubbles + typing indicator
- Markdown / code-friendly assistant rendering
- Model selector (placeholder list for future providers)
- New chat, clear history, error + retry states
- Responsive layout (desktop sidebar, mobile drawer)

## Backend

`POST /api/chat` streams plain text (mock). Replace this route later with a real multi-provider router.

## Next steps

1. Wire Groq / OpenRouter free models
2. Add fallback chain
3. Optional tools (GitHub, etc.)
