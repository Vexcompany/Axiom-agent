import type { ToolDefinition } from "@/lib/ai/types";

const MAX_READ_BYTES = 512_000;
const MAX_TREE_ENTRIES = 2_000;
/** Cap on a serialized tool result so big payloads never balloon later rounds. */
const MAX_RESULT_CHARS = 60_000;

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
  {
    type: "function",
    function: {
      name: "inspect_repository",
      description:
        "Inspect a repository: metadata, default branch, description, language, size, last push, visibility.",
      parameters: props(ownerRepo, ["owner", "repo"]),
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_file_tree",
      description:
        "List the full file tree of a branch (recursive). Best first step to understand a repo's structure. Truncated past 2000 entries.",
      parameters: props(
        { ...ownerRepo, branch: branch("Branch or ref to inspect; defaults to the default branch.") },
        ["owner", "repo"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "list_repository_contents",
      description:
        "List the contents of one directory in a repo (files and subdirectories).",
      parameters: props(
        {
          ...ownerRepo,
          path: STR("Directory path relative to the repo root; empty/omitted for the root."),
          branch: branch("Branch or ref; defaults to the default branch."),
        },
        ["owner", "repo"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the text content of a single file in a repo at a given branch or ref. Files larger than ~500KB cannot be read in full.",
      parameters: props(
        {
          ...ownerRepo,
          path: STR("File path relative to the repo root, e.g. 'README.md'."),
          branch: branch("Branch or ref; defaults to the default branch."),
        },
        ["owner", "repo", "path"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "create_branch",
      description:
        "Create a new branch from an existing base branch (defaults to the repo default branch).",
      parameters: props(
        {
          ...ownerRepo,
          newBranch: STR("Name of the branch to create, e.g. 'feature/update-readme'."),
          base: branch("Existing branch to branch from; defaults to the default branch."),
        },
        ["owner", "repo", "newBranch"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "create_or_update_file",
      description:
        "Create or update a single file on a branch with a commit message. Use for one-file changes; for multiple files use commit_changes.",
      parameters: props(
        {
          ...ownerRepo,
          path: STR("File path relative to the repo root, e.g. 'docs/guide.md'."),
          content: STR("Full new text content of the file."),
          message: STR("Commit message."),
          branch: branch("Branch to write to; defaults to the default branch."),
        },
        ["owner", "repo", "path", "content", "message"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "commit_changes",
      description:
        "Commit several file changes at once on a branch via the Git data API. Files is an array of {path, content} with full new content. One commit, one branch update.",
      parameters: props(
        {
          ...ownerRepo,
          branch: branch("Branch to commit to."),
          message: STR("Commit message."),
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: STR("File path relative to the repo root."),
                content: STR("Full new text content."),
              },
              required: ["path", "content"],
              additionalProperties: false,
            },
            description: "Files to create or overwrite in this commit.",
          },
        },
        ["owner", "repo", "branch", "message", "files"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "open_pull_request",
      description:
        "Open a pull request from a head branch into a base branch (defaults to the repo default branch).",
      parameters: props(
        {
          ...ownerRepo,
          title: STR("PR title."),
          head: STR("Source branch, e.g. 'feature/update-readme'."),
          base: branch("Target branch; defaults to the default branch."),
          body: STR("PR description (Markdown)."),
        },
        ["owner", "repo", "title", "head"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "list_pull_requests",
      description: "List open pull requests in a repo (optionally all states).",
      parameters: props(
        {
          ...ownerRepo,
          state: STR("One of 'open' (default), 'closed', 'all'."),
        },
        ["owner", "repo"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "get_pull_request",
      description:
        "Get a pull request's details, its changed files, and comments. Includes mergeable state and CI checks.",
      parameters: props(
        {
          ...ownerRepo,
          number: { type: "number", description: "Pull request number." },
        },
        ["owner", "repo", "number"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "merge_pull_request",
      description: "Merge a pull request using a squash merge.",
      parameters: props(
        {
          ...ownerRepo,
          number: { type: "number", description: "Pull request number." },
          commitTitle: STR("Optional commit title for the merge."),
        },
        ["owner", "repo", "number"]
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_workflow_runs",
      description:
        "Inspect GitHub Actions workflow runs for a branch or a single run id: status, conclusion, jobs, and a truncated log tail.",
      parameters: props(
        {
          ...ownerRepo,
          branch: branch("Filter runs by head branch; defaults to all recent runs."),
          runId: { type: "number", description: "Specific workflow run id to inspect (with jobs + log tail)." },
        },
        ["owner", "repo"]
      ),
    },
  },
];

export const GITHUB_TOOLS: readonly ToolDefinition[] = GITHUB_TOOLS_LIST;
