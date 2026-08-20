import {
  ParsedToolCall,
  ToolResult,
} from "../agent/types";
import {
  GitHubError,
  getGitHubBotIdentity,
  listInstallationRepositories,
  listInstallations,
} from "./auth";
import { encodePath, encodeRef, ghData, ghRepo } from "./client";

const MAX_READ_BYTES = 512_000;
const MAX_TREE_ENTRIES = 2_000;
const MAX_RESULT_CHARS = 60_000;

/* Argument helpers */
type Args = Record<string, unknown>;

function reqString(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new GitHubError(`Tool argument "${key}" must be a non-empty string.`, 400);
  }
  return v;
}

function optString(args: Args, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new GitHubError(`Tool argument "${key}" must be a string.`, 400);
  }
  const t = v.trim();
  return t === "" ? undefined : t;
}

function reqNumber(args: Args, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new GitHubError(`Tool argument "${key}" must be a number.`, 400);
  }
  return v;
}

function okResult(call: ParsedToolCall, data: unknown): ToolResult {
  let output: string;
  try {
    output = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    output = String(data);
  }
  if (output.length > MAX_RESULT_CHARS) {
    output =
      output.slice(0, MAX_RESULT_CHARS) +
      `\n\n[Truncated: ${output.length - MAX_RESULT_CHARS} characters omitted.]`;
  }
  return { call, ok: true, output };
}

function errResult(call: ParsedToolCall, message: string): ToolResult {
  return { call, ok: false, output: JSON.stringify({ error: message }) };
}

/** Placeholder — full tool implementations follow in next commit if this is too large. */
export async function executeGitHubTool(call: ParsedToolCall): Promise<ToolResult> {
  try {
    const args = call.arguments || {};
    // Minimal: list_repositories only for smoke test; full switch in follow-up
    if (call.name === "list_repositories") {
      const owner = optString(args, "owner");
      const installations = await listInstallations();
      const repos: unknown[] = [];
      for (const inst of installations) {
        if (owner && inst.accountLogin.toLowerCase() !== owner.toLowerCase()) continue;
        const list = await listInstallationRepositories(inst.id);
        for (const r of list) repos.push(r);
      }
      return okResult(call, { repositories: repos, count: repos.length });
    }
    return errResult(
      call,
      `Tool "${call.name}" is registered but full executor not yet deployed. Use list_repositories for now.`
    );
  } catch (err) {
    if (err instanceof GitHubError) return errResult(call, err.message);
    return errResult(
      call,
      `The tool failed unexpectedly: ${err instanceof Error ? err.message : "unknown error"}.`
    );
  }
}
