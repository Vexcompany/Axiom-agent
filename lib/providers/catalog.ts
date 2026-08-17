import type { CatalogModel, ProviderId } from "./types";

/**
 * Model catalog for Axiom AI RV v2.
 *
 * Priority for Auto (light first):
 * 1. Groq small/fast — API key auth, not shared Vercel egress IP pools like NIM
 * 2. OpenRouter :free small models — key-based, good fallback
 * 3. Cerebras — key-based, fast
 * 4. Sekai free/online — gateway; use when configured
 *
 * Avoid defaulting to huge NVIDIA NIM models from serverless shared IPs:
 * rate limits often key off source IP, and Vercel egress is shared.
 */

export const CATALOG: readonly CatalogModel[] = [
  // ── Groq (preferred for Auto) ───────────────────────────────────────────
  {
    id: "groq/llama-3.1-8b-instant",
    upstreamModel: "llama-3.1-8b-instant",
    provider: "groq",
    label: "Llama 3.1 8B Instant",
    tag: "Groq · fast · light",
    light: true,
    note: "Best default on Vercel free tier",
  },
  {
    id: "groq/llama-3.3-70b-versatile",
    upstreamModel: "llama-3.3-70b-versatile",
    provider: "groq",
    label: "Llama 3.3 70B",
    tag: "Groq · stronger",
    light: false,
  },
  {
    id: "groq/openai-gpt-oss-20b",
    upstreamModel: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT-OSS 20B",
    tag: "Groq · light",
    light: true,
  },

  // ── OpenRouter free ─────────────────────────────────────────────────────
  {
    id: "openrouter/llama-3.2-3b-instruct:free",
    upstreamModel: "meta-llama/llama-3.2-3b-instruct:free",
    provider: "openrouter",
    label: "Llama 3.2 3B (free)",
    tag: "OpenRouter · free · light",
    light: true,
  },
  {
    id: "openrouter/llama-3.3-70b-instruct:free",
    upstreamModel: "meta-llama/llama-3.3-70b-instruct:free",
    provider: "openrouter",
    label: "Llama 3.3 70B (free)",
    tag: "OpenRouter · free",
    light: false,
  },
  {
    id: "openrouter/gemma-4-31b-it:free",
    upstreamModel: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    label: "Gemma 4 31B (free)",
    tag: "OpenRouter · free",
    light: false,
  },
  {
    id: "openrouter/gpt-oss-20b:free",
    upstreamModel: "openai/gpt-oss-20b:free",
    provider: "openrouter",
    label: "GPT-OSS 20B (free)",
    tag: "OpenRouter · free · light",
    light: true,
  },

  // ── Cerebras ────────────────────────────────────────────────────────────
  {
    id: "cerebras/llama3.1-8b",
    upstreamModel: "llama3.1-8b",
    provider: "cerebras",
    label: "Llama 3.1 8B",
    tag: "Cerebras · fast · light",
    light: true,
  },
  {
    id: "cerebras/llama-3.3-70b",
    upstreamModel: "llama-3.3-70b",
    provider: "cerebras",
    label: "Llama 3.3 70B",
    tag: "Cerebras · stronger",
    light: false,
  },

  // ── Sekai gateway ───────────────────────────────────────────────────────
  {
    id: "sekai/free/gpt-5.6-luna",
    upstreamModel: "free/gpt-5.6-luna",
    provider: "sekai",
    label: "GPT-5.6 Luna (Sekai free)",
    tag: "Sekai · free · 400K",
    light: true,
  },
  {
    id: "sekai/gcli/grok-4.6",
    upstreamModel: "gcli/grok-4.6",
    provider: "sekai",
    label: "Grok 4.6 (Sekai gcli)",
    tag: "Sekai · free · 256K",
    light: false,
  },
  {
    id: "sekai/jb/sekai-flash",
    upstreamModel: "jb/sekai-flash",
    provider: "sekai",
    label: "Sekai Flash (jb)",
    tag: "Sekai · 1M",
    light: true,
  },
  {
    id: "sekai/free/grok-4.5",
    upstreamModel: "free/grok-4.5",
    provider: "sekai",
    label: "Grok 4.5 (Sekai free)",
    tag: "Sekai · may be offline",
    light: false,
    note: "Often upstream timeout",
  },
  {
    id: "sekai/free/grok-4.6",
    upstreamModel: "free/grok-4.6",
    provider: "sekai",
    label: "Grok 4.6 (Sekai free)",
    tag: "Sekai · may be offline",
    light: false,
    note: "Often upstream timeout",
  },

  // ── Mock ────────────────────────────────────────────────────────────────
  {
    id: "mock",
    upstreamModel: "mock",
    provider: "mock",
    label: "Mock stream",
    tag: "No API",
    light: true,
  },
] as const;

export function findCatalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.id === id);
}

export function modelsForProvider(provider: ProviderId): CatalogModel[] {
  return CATALOG.filter((m) => m.provider === provider);
}

/**
 * Auto chain: light models first among configured providers, then heavier.
 * Skip providers without API keys at runtime (router filters further).
 */
export function autoCandidates(): CatalogModel[] {
  const real = CATALOG.filter((m) => m.provider !== "mock");
  const light = real.filter((m) => m.light);
  const heavy = real.filter((m) => !m.light);
  return [...light, ...heavy];
}
