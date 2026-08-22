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

type Args = Record<string, unknown>;

function reqString(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new GitHubError(`Tool argument "${key}" must be a non-empty string.`, 400);
  }
  return v.trim();
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

function optNumber(args: Args, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new GitHubError(`Tool argument "${key}" must be a number.`, 400);
  }
  return v;
}

function reqNumber(args: Args, key: string): number {
  const n = optNumber(args, key);
  if (n === undefined) {
    throw new GitHubError(`Tool argument "${key}" must be a number.`, 400);
  }
  return n;
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

async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
  const meta = await ghData<{ default_branch?: string }>(owner, repo, "");
  return meta.default_branch || "main";
}

function decodeContent(contentBase64: string): string {
  const cleaned = contentBase64.replace(/\s+/g, "");
  const bin = atob(cleaned);
  try {
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return bin;
  }
}

export async function executeGitHubTool(call: ParsedToolCall): Promise<ToolResult> {
  try {
    const args = call.arguments || {};

    switch (call.name) {
      case "list_repositories": {
        const owner = optString(args, "owner");
        const installations = await listInstallations();
        const repositories: Array<{
          full_name: string;
          name: string;
          private: boolean;
          default_branch: string;
          owner_login: string;
          installation_id: number;
        }> = [];
        for (const inst of installations) {
          if (owner && inst.login.toLowerCase() !== owner.toLowerCase()) continue;
          const list = await listInstallationRepositories(inst.id);
          for (const r of list) {
            repositories.push({
              full_name: r.fullName,
              name: r.name,
              private: r.private,
              default_branch: r.defaultBranch,
              owner_login: inst.login,
              installation_id: inst.id,
            });
          }
        }
        const index = repositories.map((r) => r.full_name);
        return okResult(call, {
          count: repositories.length,
          full_names: index,
          repositories,
        });
      }

      case "inspect_repository": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const data = await ghData<{
          full_name?: string;
          description?: string | null;
          private?: boolean;
          default_branch?: string;
          language?: string | null;
          stargazers_count?: number;
          forks_count?: number;
          open_issues_count?: number;
          size?: number;
          pushed_at?: string;
          html_url?: string;
          topics?: string[];
        }>(owner, repo, "");
        return okResult(call, {
          full_name: data.full_name,
          description: data.description ?? null,
          private: data.private === true,
          default_branch: data.default_branch ?? "main",
          language: data.language ?? null,
          stars: data.stargazers_count ?? 0,
          forks: data.forks_count ?? 0,
          open_issues: data.open_issues_count ?? 0,
          size_kb: data.size ?? 0,
          pushed_at: data.pushed_at ?? null,
          html_url: data.html_url ?? null,
          topics: data.topics ?? [],
        });
      }

      case "inspect_file_tree": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const branch = optString(args, "branch") || (await resolveDefaultBranch(owner, repo));
        const data = await ghData<{
          tree?: Array<{ path?: string; type?: string; size?: number }>;
          truncated?: boolean;
        }>(owner, repo, `/git/trees/${encodeRef(branch)}?recursive=1`);
        const tree = (data.tree ?? [])
          .filter((e) => e.path)
          .slice(0, MAX_TREE_ENTRIES)
          .map((e) => ({
            path: e.path as string,
            type: e.type === "tree" ? "dir" : "file",
            size: e.size ?? 0,
          }));
        return okResult(call, {
          branch,
          truncated: data.truncated === true || (data.tree?.length ?? 0) > MAX_TREE_ENTRIES,
          count: tree.length,
          entries: tree,
        });
      }

      case "list_repository_contents": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const path = optString(args, "path") || "";
        const branch = optString(args, "branch") || (await resolveDefaultBranch(owner, repo));
        const q = path ? `/${encodePath(path)}` : "";
        const data = await ghData<
          | Array<{ name?: string; path?: string; type?: string; size?: number; sha?: string }>
          | { name?: string; path?: string; type?: string }
        >(owner, repo, `/contents${q}?ref=${encodeRef(branch)}`);
        if (!Array.isArray(data)) {
          return okResult(call, {
            branch,
            path: path || "/",
            entries: [{ name: data.name, path: data.path, type: data.type }],
          });
        }
        return okResult(call, {
          branch,
          path: path || "/",
          count: data.length,
          entries: data.map((e) => ({
            name: e.name,
            path: e.path,
            type: e.type,
            size: e.size ?? 0,
            sha: e.sha,
          })),
        });
      }

      case "read_file": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const path = reqString(args, "path");
        const branch = optString(args, "branch") || (await resolveDefaultBranch(owner, repo));
        const data = await ghData<{
          type?: string;
          encoding?: string;
          content?: string;
          size?: number;
          sha?: string;
          path?: string;
          name?: string;
        }>(owner, repo, `/contents/${encodePath(path)}?ref=${encodeRef(branch)}`);
        if (data.type !== "file") {
          throw new GitHubError(`Path "${path}" is not a file (type=${data.type ?? "unknown"}).`, 400);
        }
        if ((data.size ?? 0) > MAX_READ_BYTES) {
          throw new GitHubError(
            `File "${path}" is too large (${data.size} bytes; max ${MAX_READ_BYTES}).`,
            400
          );
        }
        if (data.encoding !== "base64" || typeof data.content !== "string") {
          throw new GitHubError(`Cannot decode file "${path}" (encoding=${data.encoding}).`, 502);
        }
        const text = decodeContent(data.content);
        return okResult(call, {
          path: data.path ?? path,
          branch,
          sha: data.sha,
          size: data.size ?? text.length,
          content: text,
        });
      }

      case "create_branch": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const branch = reqString(args, "branch");
        const from = optString(args, "from") || (await resolveDefaultBranch(owner, repo));
        const ref = await ghData<{ object?: { sha?: string } }>(
          owner,
          repo,
          `/git/ref/heads/${encodeRef(from)}`
        );
        const sha = ref.object?.sha;
        if (!sha) throw new GitHubError(`Could not resolve ref heads/${from}.`, 502);
        await ghRepo(owner, repo, "/git/refs", {
          method: "POST",
          body: { ref: `refs/heads/${branch}`, sha },
        });
        return okResult(call, { owner, repo, branch, from, sha });
      }

      case "create_or_update_file": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const path = reqString(args, "path");
        const content = reqString(args, "content");
        const message = reqString(args, "message");
        const branch = optString(args, "branch") || (await resolveDefaultBranch(owner, repo));
        const bot = getGitHubBotIdentity();
        let sha: string | undefined;
        try {
          const existing = await ghData<{ sha?: string; type?: string }>(
            owner,
            repo,
            `/contents/${encodePath(path)}?ref=${encodeRef(branch)}`
          );
          if (existing.type === "file" && existing.sha) sha = existing.sha;
        } catch (err) {
          if (!(err instanceof GitHubError && err.status === 404)) throw err;
        }
        const bytes = new TextEncoder().encode(content);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
        const contentB64 = btoa(binary);
        const body: Record<string, unknown> = {
          message,
          content: contentB64,
          branch,
          committer: { name: bot.name, email: bot.email },
          author: { name: bot.name, email: bot.email },
        };
        if (sha) body.sha = sha;
        const result = await ghData<{
          content?: { path?: string; sha?: string; html_url?: string };
          commit?: { sha?: string; html_url?: string; message?: string };
        }>(owner, repo, `/contents/${encodePath(path)}`, { method: "PUT", body });
        return okResult(call, {
          path: result.content?.path ?? path,
          branch,
          content_sha: result.content?.sha,
          commit_sha: result.commit?.sha,
          html_url: result.content?.html_url ?? result.commit?.html_url,
          message: result.commit?.message ?? message,
        });
      }

      case "commit_changes": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const message = reqString(args, "message");
        const branch = optString(args, "branch") || (await resolveDefaultBranch(owner, repo));
        const filesRaw = args.files;
        if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
          throw new GitHubError('Argument "files" must be a non-empty array of {path, content}.', 400);
        }
        const files = filesRaw.map((f, i) => {
          if (!f || typeof f !== "object") {
            throw new GitHubError(`files[${i}] must be an object.`, 400);
          }
          const o = f as Record<string, unknown>;
          if (typeof o.path !== "string" || !o.path.trim()) {
            throw new GitHubError(`files[${i}].path must be a non-empty string.`, 400);
          }
          if (typeof o.content !== "string") {
            throw new GitHubError(`files[${i}].content must be a string.`, 400);
          }
          return { path: o.path.trim(), content: o.content };
        });
        const bot = getGitHubBotIdentity();

        const ref = await ghData<{ object?: { sha?: string } }>(
          owner,
          repo,
          `/git/ref/heads/${encodeRef(branch)}`
        );
        const baseCommitSha = ref.object?.sha;
        if (!baseCommitSha) throw new GitHubError(`Could not resolve heads/${branch}.`, 502);

        const baseCommit = await ghData<{ tree?: { sha?: string } }>(
          owner,
          repo,
          `/git/commits/${baseCommitSha}`
        );
        const baseTreeSha = baseCommit.tree?.sha;
        if (!baseTreeSha) throw new GitHubError("Could not resolve base tree.", 502);

        const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
        for (const file of files) {
          const blob = await ghData<{ sha?: string }>(owner, repo, "/git/blobs", {
            method: "POST",
            body: { content: file.content, encoding: "utf-8" },
          });
          if (!blob.sha) throw new GitHubError(`Failed to create blob for ${file.path}.`, 502);
          treeItems.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
        }

        const newTree = await ghData<{ sha?: string }>(owner, repo, "/git/trees", {
          method: "POST",
          body: { base_tree: baseTreeSha, tree: treeItems },
        });
        if (!newTree.sha) throw new GitHubError("Failed to create tree.", 502);

        const newCommit = await ghData<{ sha?: string; html_url?: string }>(owner, repo, "/git/commits", {
          method: "POST",
          body: {
            message,
            tree: newTree.sha,
            parents: [baseCommitSha],
            author: { name: bot.name, email: bot.email },
            committer: { name: bot.name, email: bot.email },
          },
        });
        if (!newCommit.sha) throw new GitHubError("Failed to create commit.", 502);

        await ghRepo(owner, repo, `/git/refs/heads/${encodeRef(branch)}`, {
          method: "PATCH",
          body: { sha: newCommit.sha },
        });

        return okResult(call, {
          owner,
          repo,
          branch,
          commit_sha: newCommit.sha,
          html_url: newCommit.html_url,
          files: files.map((f) => f.path),
        });
      }

      case "open_pull_request": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const title = reqString(args, "title");
        const head = reqString(args, "head");
        const base = optString(args, "base") || (await resolveDefaultBranch(owner, repo));
        const body = optString(args, "body") || "";
        const pr = await ghData<{
          number?: number;
          html_url?: string;
          state?: string;
          title?: string;
        }>(owner, repo, "/pulls", {
          method: "POST",
          body: { title, head, base, body },
        });
        return okResult(call, {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          html_url: pr.html_url,
          head,
          base,
        });
      }

      case "list_pull_requests": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const state = optString(args, "state") || "open";
        const data = await ghData<
          Array<{
            number?: number;
            title?: string;
            state?: string;
            html_url?: string;
            user?: { login?: string };
            head?: { ref?: string };
            base?: { ref?: string };
          }>
        >(owner, repo, `/pulls?state=${encodeURIComponent(state)}&per_page=30`);
        return okResult(call, {
          count: data.length,
          pull_requests: data.map((p) => ({
            number: p.number,
            title: p.title,
            state: p.state,
            html_url: p.html_url,
            user: p.user?.login,
            head: p.head?.ref,
            base: p.base?.ref,
          })),
        });
      }

      case "get_pull_request": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const number = reqNumber(args, "number");
        const pr = await ghData<{
          number?: number;
          title?: string;
          body?: string | null;
          state?: string;
          html_url?: string;
          merged?: boolean;
          mergeable?: boolean | null;
          user?: { login?: string };
          head?: { ref?: string; sha?: string };
          base?: { ref?: string; sha?: string };
        }>(owner, repo, `/pulls/${number}`);
        return okResult(call, {
          number: pr.number,
          title: pr.title,
          body: pr.body ?? "",
          state: pr.state,
          merged: pr.merged === true,
          mergeable: pr.mergeable ?? null,
          html_url: pr.html_url,
          user: pr.user?.login,
          head: pr.head,
          base: pr.base,
        });
      }

      case "merge_pull_request": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const number = reqNumber(args, "number");
        const commitTitle = optString(args, "commitTitle");
        const body: Record<string, unknown> = { merge_method: "squash" };
        if (commitTitle) body.commit_title = commitTitle;
        const result = await ghData<{
          merged?: boolean;
          message?: string;
          sha?: string;
        }>(owner, repo, `/pulls/${number}/merge`, { method: "PUT", body });
        return okResult(call, {
          number,
          merged: result.merged === true,
          message: result.message,
          sha: result.sha,
        });
      }

      case "inspect_workflow_runs": {
        const owner = reqString(args, "owner");
        const repo = reqString(args, "repo");
        const runId = optNumber(args, "runId");
        if (runId !== undefined) {
          const run = await ghData<{
            id?: number;
            name?: string;
            status?: string;
            conclusion?: string | null;
            html_url?: string;
            head_branch?: string;
            event?: string;
            created_at?: string;
            updated_at?: string;
          }>(owner, repo, `/actions/runs/${runId}`);
          return okResult(call, { run });
        }
        const branch = optString(args, "branch");
        const q = branch
          ? `?branch=${encodeURIComponent(branch)}&per_page=15`
          : "?per_page=15";
        const data = await ghData<{
          total_count?: number;
          workflow_runs?: Array<{
            id?: number;
            name?: string;
            status?: string;
            conclusion?: string | null;
            html_url?: string;
            head_branch?: string;
            event?: string;
            created_at?: string;
          }>;
        }>(owner, repo, `/actions/runs${q}`);
        return okResult(call, {
          total_count: data.total_count ?? 0,
          runs: (data.workflow_runs ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            status: r.status,
            conclusion: r.conclusion,
            head_branch: r.head_branch,
            event: r.event,
            html_url: r.html_url,
            created_at: r.created_at,
          })),
        });
      }

      default:
        return errResult(
          call,
          `Unknown GitHub tool "${call.name}". Available: list_repositories, inspect_repository, inspect_file_tree, list_repository_contents, read_file, create_branch, create_or_update_file, commit_changes, open_pull_request, list_pull_requests, get_pull_request, merge_pull_request, inspect_workflow_runs.`
        );
    }
  } catch (err) {
    if (err instanceof GitHubError) return errResult(call, err.message);
    return errResult(
      call,
      `The tool failed unexpectedly: ${err instanceof Error ? err.message : "unknown error"}.`
    );
  }
}
