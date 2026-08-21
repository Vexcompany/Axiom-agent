import type { CatalogModel, ProviderId } from "./types";

/**
 * Model catalog — Aug 2026.
 * Groq shut down llama-3.1-8b-instant and llama-3.3-70b-versatile on 2026-08-16.
 * Replacements: openai/gpt-oss-20b and openai/gpt-oss-120b (or qwen/qwen3.6-27b).
 * Gemini 2.5 Flash is no longer available to new users → use gemini-3.5-flash-lite / gemini-3.6-flash.
 * SenseNova via token.sensenova.ai OpenAI-compat.
 */

export const CATALOG: readonly CatalogModel[] = [
  {
    id: "gemini/gemini-3.5-flash-lite",
    upstreamModel: "gemini-3.5-flash-lite",
    provider: "google",
    label: "Gemini 3.5 Flash-Lite",
    tag: "Google · free · Flash-Lite · high throughput",
    light: true,
    note: "Replaces gemini-2.5-flash (no longer available to new users)",
  },
  {
    id: "gemini/gemini-3.6-flash",
    upstreamModel: "gemini-3.6-flash",
    provider: "google",
    label: "Gemini 3.6 Flash",
    tag: "Google · Flash · agentic / coding",
    light: false,
    note: "Gemini 3.6 Flash — function calling supported",
  },
  {
    id: "sensenova/sensenova-6.8-flash-lite",
    upstreamModel: "sensenova-6.8-flash-lite",
    provider: "sensenova",
    label: "SenseNova 6.8 Flash Lite",
    tag: "SenseNova · flash-lite",
    light: true,
  },
  {
    id: "sensenova/sensenova-u1-fast",
    upstreamModel: "sensenova-u1-fast",
    provider: "sensenova",
    label: "SenseNova U1 Fast",
    tag: "SenseNova · fast",
    light: true,
  },
  {
    id: "groq/openai-gpt-oss-20b",
    upstreamModel: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT-OSS 20B",
    tag: "Groq · free tier · light",
    light: true,
    note: "Default light (replaces deprecated Llama 3.1 8B)",
  },
  {
    id: "groq/openai-gpt-oss-120b",
    upstreamModel: "openai/gpt-oss-120b",
    provider: "groq",
    label: "GPT-OSS 120B",
    tag: "Groq · free tier",
    light: false,
  },
  {
    id: "groq/qwen3.6-27b",
    upstreamModel: "qwen/qwen3.6-27b",
    provider: "groq",
    label: "Qwen3.6 27B",
    tag: "Groq · free tier",
    light: false,
  },
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
    light: true,
  },
  {
    id: "cerebras/gemma-4-31b",
    upstreamModel: "gemma-4-31b",
    provider: "cerebras",
    label: "Gemma 4 31B",
    tag: "Cerebras",
    light: false,
  },
  {
    id: "cerebras/gpt-oss-120b",
    upstreamModel: "gpt-oss-120b",
    provider: "cerebras",
    label: "GPT-OSS 120B",
    tag: "Cerebras",
    light: false,
  },
  {
    id: "sekai/free/gpt-5.6-luna",
    upstreamModel: "free/gpt-5.6-luna",
    provider: "sekai",
    label: "GPT-5.6 Luna",
    tag: "Sekai · free",
    light: true,
  },
  {
    id: "sekai/gcli/grok-4.6",
    upstreamModel: "gcli/grok-4.6",
    provider: "sekai",
    label: "Grok 4.6 gcli",
    tag: "Sekai",
    light: false,
  },
  {
    id: "sekai/jb/sekai-flash",
    upstreamModel: "jb/sekai-flash",
    provider: "sekai",
    label: "Flash jb",
    tag: "Sekai",
    light: true,
  },
  {
    id: "sekai/free/grok-4.5",
    upstreamModel: "free/grok-4.5",
    provider: "sekai",
    label: "Grok 4.5 free",
    tag: "Sekai · often offline",
    light: true,
  },
  {
    id: "sekai/free/grok-4.6",
    upstreamModel: "free/grok-4.6",
    provider: "sekai",
    label: "Grok 4.6 free",
    tag: "Sekai · often offline",
    light: true,
  },
  {
    id: "mock",
    upstreamModel: "mock",
    provider: "mock",
    label: "Mock stream",
    tag: "no API",
    light: true,
  },
];

export function findCatalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.id === id);
}

export function autoCandidates(preferLight = true): CatalogModel[] {
  const real = CATALOG.filter((m) => m.provider !== "mock");
  if (!preferLight) return [...real];
  const light = real.filter((m) => m.light);
  const heavy = real.filter((m) => !m.light);
  return [...light, ...heavy];
}

export type { CatalogModel, ProviderId };
