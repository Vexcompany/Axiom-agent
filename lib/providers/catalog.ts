import type { CatalogModel, ProviderId } from "./types";

/**
 * Model catalog — refreshed Aug 2026 from provider docs / OpenRouter free list.
 *
 * Auto order: light + reliable key-based first (Groq 8B, OpenRouter free small,
 * Cerebras), then stronger free models. Sticky preferred model is handled in
 * the router (session continues on the same model when possible).
 */

export const CATALOG: readonly CatalogModel[] = [
  // ── Groq (free tier = rate limits, all listed models) ────────────────────
  {
    id: "groq/llama-3.1-8b-instant",
    upstreamModel: "llama-3.1-8b-instant",
    provider: "groq",
    label: "Llama 3.1 8B Instant",
    tag: "Groq · free tier · light",
    light: true,
    note: "Fast default",
  },
  {
    id: "groq/openai-gpt-oss-20b",
    upstreamModel: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT-OSS 20B",
    tag: "Groq · free tier · light",
    light: true,
  },
  {
    id: "groq/llama-3.3-70b-versatile",
    upstreamModel: "llama-3.3-70b-versatile",
    provider: "groq",
    label: "Llama 3.3 70B",
    tag: "Groq · free tier",
    light: false,
  },
  {
    id: "groq/openai-gpt-oss-120b",
    upstreamModel: "openai/gpt-oss-120b",
    provider: "groq",
    label: "GPT-OSS 120B",
    tag: "Groq · free tier",
    light: false,
  },

  // ── OpenRouter :free (Aug 2026) ─────────────────────────────────────────
  {
    id: "openrouter/free",
    upstreamModel: "openrouter/free",
    provider: "openrouter",
    label: "OpenRouter Free Router",
    tag: "OpenRouter · free · auto-pick",
    light: true,
    note: "Official free-model router",
  },
  {
    id: "openrouter/gemma-4-26b-a4b-it:free",
    upstreamModel: "google/gemma-4-26b-a4b-it:free",
    provider: "openrouter",
    label: "Gemma 4 26B A4B (free)",
    tag: "OpenRouter · free · light",
    light: true,
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
    id: "openrouter/qwen3-8b:free",
    upstreamModel: "qwen/qwen3-8b:free",
    provider: "openrouter",
    label: "Qwen3 8B (free)",
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
    id: "openrouter/north-mini-code:free",
    upstreamModel: "cohere/north-mini-code:free",
    provider: "openrouter",
    label: "North Mini Code (free)",
    tag: "OpenRouter · free · coding",
    light: true,
  },
  {
    id: "openrouter/nemotron-3.5-lightning:free",
    upstreamModel: "nvidia/nemotron-3.5-lightning:free",
    provider: "openrouter",
    label: "Nemotron 3.5 Lightning (free)",
    tag: "OpenRouter · free",
    light: false,
    note: "Via OpenRouter key, not direct NIM IP",
  },

  // ── Cerebras (public catalog) ───────────────────────────────────────────
  {
    id: "cerebras/gpt-oss-120b",
    upstreamModel: "gpt-oss-120b",
    provider: "cerebras",
    label: "GPT-OSS 120B",
    tag: "Cerebras · free tier",
    light: false,
  },
  {
    id: "cerebras/gemma-4-31b",
    upstreamModel: "gemma-4-31b",
    provider: "cerebras",
    label: "Gemma 4 31B",
    tag: "Cerebras · free tier",
    light: true,
  },

  // ── Sekai gateway ───────────────────────────────────────────────────────
  {
    id: "sekai/free/gpt-5.6-luna",
    upstreamModel: "free/gpt-5.6-luna",
    provider: "sekai",
    label: "GPT-5.6 Luna (Sekai)",
    tag: "Sekai · free",
    light: true,
  },
  {
    id: "sekai/gcli/grok-4.6",
    upstreamModel: "gcli/grok-4.6",
    provider: "sekai",
    label: "Grok 4.6 (Sekai gcli)",
    tag: "Sekai · free",
    light: false,
  },
  {
    id: "sekai/jb/sekai-flash",
    upstreamModel: "jb/sekai-flash",
    provider: "sekai",
    label: "Sekai Flash (jb)",
    tag: "Sekai",
    light: true,
  },
  {
    id: "sekai/free/grok-4.5",
    upstreamModel: "free/grok-4.5",
    provider: "sekai",
    label: "Grok 4.5 (Sekai)",
    tag: "Sekai · often offline",
    light: false,
    note: "Upstream timeout common",
  },
  {
    id: "sekai/free/grok-4.6",
    upstreamModel: "free/grok-4.6",
    provider: "sekai",
    label: "Grok 4.6 (Sekai free)",
    tag: "Sekai · often offline",
    light: false,
    note: "Upstream timeout common",
  },

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

export function autoCandidates(): CatalogModel[] {
  const real = CATALOG.filter((m) => m.provider !== "mock");
  const light = real.filter((m) => m.light);
  const heavy = real.filter((m) => !m.light);
  return [...light, ...heavy];
}
