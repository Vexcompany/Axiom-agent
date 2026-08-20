/**
 * Temporary re-export stub. Full GitHub tools from Raphael-agent must be
 * present as this module — if toolsDefs/toolsExec are missing, copy tools.ts
 * from Raphael-agent/raphael/lib/github/tools.ts into this path.
 *
 * This stub prevents a broken import graph; replace with the full Raphael tools.ts.
 */
import type { ParsedToolCall, ToolDefinition, ToolResult } from "@/lib/ai/types";

export const GITHUB_TOOLS: readonly ToolDefinition[] = [];

export async function executeGitHubTool(call: ParsedToolCall): Promise<ToolResult> {
  return {
    call,
    ok: false,
    output: `Error: GitHub tool "${call.name}" is not fully deployed yet. Copy lib/github/tools.ts from Raphael-agent into Axiom-agent.`,
  };
}
