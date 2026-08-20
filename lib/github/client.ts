import {
  GitHubError,
  getGitHubApiBase,
  getInstallationAccessToken,
  getInstallationTokenById,
} from "./auth";

const REQUEST_TIMEOUT_MS = 20_000;

export function encodeRef(ref: string): string {
  return encodeURIComponent(ref.replace(/^refs\//, ""));
}

export function encodePath(path: string): string {
  return path
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export interface GitHubRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  accept?: string;
}

interface GitHubResponse<T> {
  status: number;
  data: T;
  text: string;
}

async function request(
  url: string,
  token: string,
  opts: GitHubRequestOptions = {}
): Promise<GitHubResponse<unknown>> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: opts.accept ?? "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: timeout,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new GitHubError("The GitHub API timed out.", 504);
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new GitHubError("The GitHub request was cancelled.", 499);
    }
    throw new GitHubError("Could not reach the GitHub API.", 502);
  }

  const text = await res.text();
  if (!res.ok) {
    throw await parseGitHubError(res.status, text);
  }

  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data, text };
}

async function parseGitHubError(status: number, body: string): Promise<GitHubError> {
  let message = `GitHub API error (status ${status}).`;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message) {
      message = parsed.message;
    }
  } catch {
    if (body) message = body.slice(0, 500);
  }
  let mapped = 502;
  if (status === 401 || status === 403) mapped = 403;
  else if (status === 404) mapped = 404;
  else if (status === 409 || status === 422) mapped = 409;
  return new GitHubError(`${message} (GitHub ${status})`, mapped);
}

export async function ghRepo(
  owner: string,
  repo: string,
  path: string,
  opts?: GitHubRequestOptions
): Promise<GitHubResponse<unknown>> {
  const token = await getInstallationAccessToken(owner, repo);
  return request(
    `${getGitHubApiBase()}/repos/${encodePath(owner)}/${encodePath(repo)}${path}`,
    token,
    opts
  );
}

export async function ghInstallation(
  installationId: number,
  path: string,
  opts?: GitHubRequestOptions
): Promise<GitHubResponse<unknown>> {
  const token = await getInstallationTokenById(installationId);
  return request(`${getGitHubApiBase()}/installation${path}`, token, opts);
}

export async function ghData<T>(
  owner: string,
  repo: string,
  path: string,
  opts?: GitHubRequestOptions
): Promise<T> {
  const res = await ghRepo(owner, repo, path, opts);
  return res.data as T;
} 
