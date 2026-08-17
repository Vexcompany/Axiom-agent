/**
 * Sekai gateway free-model catalog (OpenAI-compatible chat completions).
 *
 * Model ids are sent to the gateway exactly as listed.
 * Availability is a snapshot hint for the UI / auto router — live status
 * can change on the gateway side.
 */

export type ModelAvailability = "online" | "offline";

export interface SekaiModel {
  /** Exact model id for the API `model` field. */
  id: string;
  /** Label shown in the UI. */
  label: string;
  /** Gateway channel / prefix group. */
  channel: "free" | "gcli" | "jb";
  /** Short capability tag. */
  tag: string;
  /** Context window size (tokens), approximate. */
  contextTokens: number;
  /** Last known availability hint. */
  availability: ModelAvailability;
  /** Optional note (e.g. upstream timeout). */
  note?: string;
}

export const SEKAI_MODELS: readonly SekaiModel[] = [
  {
    id: "free/gpt-5.6-luna",
    label: "GPT-5.6 Luna (free)",
    channel: "free",
    tag: "Reasoning · 400K",
    contextTokens: 400_000,
    availability: "online",
  },
  {
    id: "gcli/grok-4.6",
    label: "Grok 4.6 (gcli)",
    channel: "gcli",
    tag: "Reasoning · 256K",
    contextTokens: 256_000,
    availability: "online",
  },
  {
    id: "jb/sekai-flash",
    label: "Sekai Flash (jb)",
    channel: "jb",
    tag: "Uncensored · 1M",
    contextTokens: 1_000_000,
    availability: "online",
  },
  {
    id: "free/grok-4.5",
    label: "Grok 4.5 (free)",
    channel: "free",
    tag: "Reasoning · 500K",
    contextTokens: 500_000,
    availability: "offline",
    note: "Upstream timeout",
  },
  {
    id: "free/grok-4.6",
    label: "Grok 4.6 (free)",
    channel: "free",
    tag: "Reasoning · 256K",
    contextTokens: 256_000,
    availability: "offline",
    note: "Upstream timeout",
  },
] as const;

export const DEFAULT_SEKAI_MODEL = "free/gpt-5.6-luna";

/** Prefer online models for Auto; offline still allowed if user picks them. */
export function autoFallbackChain(): string[] {
  const online = SEKAI_MODELS.filter((m) => m.availability === "online").map(
    (m) => m.id
  );
  const offline = SEKAI_MODELS.filter((m) => m.availability === "offline").map(
    (m) => m.id
  );
  return [...online, ...offline];
}

export function findModel(id: string): SekaiModel | undefined {
  return SEKAI_MODELS.find((m) => m.id === id);
}

export function isKnownModel(id: string): boolean {
  return SEKAI_MODELS.some((m) => m.id === id);
}
