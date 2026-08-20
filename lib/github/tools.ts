import type { ParsedToolCall, ToolResult } from "@/lib/ai/types";

/**
 * GitHub tools entry for the Next.js side.
 *
 * Definitions live in toolsDefs. Execution of tools runs only on the
 * Cloudflare Worker (agent loop). This file satisfies TypeScript for any
 * leftover imports (e.g. lib/agent/runChat) without requiring toolsExec.
 */
export { GITHUB_TOOLS } from "./toolsDefs";

export async function executeGitHubTool(
  call: ParsedToolCall
): Promise<ToolResult> {
  return {
    call,
    ok: false,
    output: JSON.stringify({
      error:
        "GitHub tool execution runs on the Cloudflare Worker, not on Vercel.",
      tool: call.name,
    }),
  };
}
