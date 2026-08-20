import {
  ParsedToolCall,
  ToolDefinition,
  ToolResult,
} from "@/lib/ai/types";
import {
  GitHubError,
  getGitHubBotIdentity,
  listInstallationRepositories,
  listInstallations,
} from "./auth";
import { encodePath, encodeRef, ghData, ghRepo } from "./client";

/**
 * GitHub tool definitions + dispatcher.
 *
 * Each tool reads from a repo/installation through the GitHub App and
 * returns a safe JSON string the model consumes. Never returns tokens or
 * other secrets. When a tool fails the result carries `ok: false` with the
 * actual error message so the model can report honestly.
 */

const MAX_READ_BYTES = 512_000;
const MAX_TREE_ENTRIES = 2_000;
/** Cap on a serialized tool result so big payloads never balloon later rounds. */
const MAX_RESULT_CHARS = 60_000;

/* ------------------------------------------------------------------ */
/* Tool definitions                                                    */
/* ------------------------------------------------------------------ */

const STR = (description: string) => ({ type: "string", description });

const branch = STR;

function props(
  properties: Record<string, unknown>,
  required: string[]
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const ownerRepo = {
  owner: STR("Repository owner (user or org), e.g. 'Vexcompany'."),
  repo: STR("Repository name, e.g. 'Axiom-agent'."),
};

const GITHUB_TOOLS_LIST: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_repositories",
      description:
        "List repositories the Axiom AI RV GitHub App can access. Optionally filter by the owning account's login.",
      parameters: props(
        { owner: STR("Optional account login to filter by, e.g. 'Vexcompany'.") },
        []
      ),
    },
  },
];

export const GITHUB_TOOLS: readonly ToolDefinition[] = GITHUB_TOOLS_LIST;

export async function executeGitHubTool(call: ParsedToolCall): Promise<ToolResult> {
  return {
    call,
    ok: false,
    output: JSON.stringify({ error: "tools incomplete - full content pending" }),
  };
}
