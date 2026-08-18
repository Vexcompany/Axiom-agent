import type { ChatMessage } from "@/lib/providers/types";

/**
 * Extractive memory — no extra LLM call (avoids 2x latency + timeout risk).
 *
 * Keeps the last `keepRecent` messages intact. Older turns are folded into a
 * short factual summary injected into the system prompt.
 */

export interface CompactResult {
  /** Messages to send to the model (system is applied separately). */
  recent: ChatMessage[];
  /** Summary of older turns, or empty if nothing was compacted. */
  memorySummary: string;
}

const DEFAULT_KEEP = 12;
const MAX_SNIPPET = 180;
const MAX_SUMMARY_CHARS = 2500;

export function compactMessages(
  messages: ChatMessage[],
  opts?: { keepRecent?: number; existingSummary?: string }
): CompactResult {
  const keep = Math.max(4, opts?.keepRecent ?? DEFAULT_KEEP);
  const existing = (opts?.existingSummary ?? "").trim();

  if (messages.length <= keep) {
    return {
      recent: messages,
      memorySummary: existing,
    };
  }

  const older = messages.slice(0, -keep);
  const recent = messages.slice(-keep);

  const lines: string[] = [];
  if (existing) {
    lines.push(existing);
    lines.push("---");
  }

  for (const m of older) {
    const role = m.role === "user" ? "User" : "Assistant";
    const text = collapse(m.content);
    if (!text) continue;
    lines.push(`${role}: ${text}`);
  }

  let memorySummary = lines.join("\n");
  if (memorySummary.length > MAX_SUMMARY_CHARS) {
    memorySummary =
      "…(earlier context truncated)…\n" +
      memorySummary.slice(-(MAX_SUMMARY_CHARS - 40));
  }

  return { recent, memorySummary };
}

function collapse(content: string): string {
  const one = content.replace(/\s+/g, " ").trim();
  if (one.length <= MAX_SNIPPET) return one;
  return one.slice(0, MAX_SNIPPET - 1) + "…";
}
