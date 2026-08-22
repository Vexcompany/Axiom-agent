export function getGitHubApiBase(): string {
  return (process.env.GITHUB_API_BASE_URL || "https://api.github.com").replace(/\/+$/, "");
}

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

export interface GitHubConfig {
  appId: string;
  privateKey: string;
}

export function getGitHubConfig(): GitHubConfig | null {
  const appId = (process.env.GITHUB_APP_ID || "").trim().replace(/^["']|["']$/g, "");
  const privateKey = process.env.GITHUB_PRIVATE_KEY;
  if (!appId || !privateKey) return null;
  return { appId, privateKey };
}

export function isGitHubConfigured(): boolean {
  return getGitHubConfig() !== null;
}

export function getGitHubBotIdentity(): { name: string; email: string } {
  return {
    name: process.env.GITHUB_BOT_NAME || "axiom-ai-rv[bot]",
    email:
      process.env.GITHUB_BOT_EMAIL ||
      "axiom-ai-rv[bot]@users.noreply.github.com",
  };
}

function normalizePrivateKey(raw: string): string {
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!s.includes("-----BEGIN")) {
    try {
      const decoded = atob(s.replace(/\s+/g, ""));
      if (decoded.includes("-----BEGIN")) s = decoded;
    } catch {
      /* not base64 */
    }
  }
  if (s.includes("-----BEGIN") && !s.includes("\n")) {
    s = s
      .replace(/(-----BEGIN [A-Z ]+-----)/, "$1\n")
      .replace(/(-----END [A-Z ]+-----)/, "\n$1");
  }
  if (s.includes("-----BEGIN") && !s.endsWith("\n")) s += "\n";
  return s;
}

function pemBodyToBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, "")
    .replace(/-----END [A-Z0-9 ]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Wrap PKCS#1 RSAPrivateKey DER in PKCS#8 PrivateKeyInfo for Web Crypto. */
function pkcs1DerToPkcs8Der(pkcs1: Uint8Array): Uint8Array {
  const oid = Uint8Array.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const len = (n: number): number[] => {
    if (n < 0x80) return [n];
    if (n < 0x100) return [0x81, n];
    return [0x82, (n >> 8) & 0xff, n & 0xff];
  };
  const octet = Uint8Array.from([0x04, ...len(pkcs1.length), ...pkcs1]);
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const body = Uint8Array.from([...version, ...oid, ...octet]);
  return Uint8Array.from([0x30, ...len(body.length), ...body]);
}

function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = normalizePrivateKey(pem);
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(normalized);
  const isPkcs8 = /BEGIN PRIVATE KEY/.test(normalized);
  if (!isPkcs1 && !isPkcs8) {
    throw new GitHubError(
      "Failed to parse private key: expected PEM with BEGIN RSA PRIVATE KEY or BEGIN PRIVATE KEY. Re-set with: npx wrangler secret put GITHUB_PRIVATE_KEY",
      503
    );
  }
  let der = pemBodyToBytes(normalized);
  if (isPkcs1) der = pkcs1DerToPkcs8Der(der);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    throw new GitHubError(
      "Failed to import private key for JWT signing (Web Crypto). Ensure GITHUB_PRIVATE_KEY is a valid RSA PEM from your GitHub App.",
      503
    );
  }
}

async function signJwt(
  payload: Record<string, unknown>,
  pem: string
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importPrivateKey(pem);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${toBase64Url(sig)}`;
}

let jwtCache: { token: string; expiresAt: number } | null = null;
const JWT_MAX_TTL_S = 10 * 60;
const JWT_REFRESH_BEFORE_S = 60;

async function getAppJwt(): Promise<string> {
  const cfg = getGitHubConfig();
  if (!cfg) {
    throw new GitHubError("The GitHub App is not configured on this server.", 503);
  }
  // GitHub requires `iss` to be the numeric App ID (JSON number, not a string).
  if (!/^[0-9]+$/.test(cfg.appId)) {
    throw new GitHubError(
      `GITHUB_APP_ID must be digits only (the App ID from github.com/settings/apps). Got: "${cfg.appId.slice(0, 32)}"`,
      503
    );
  }
  const appIdNum = Number(cfg.appId);
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache && now < jwtCache.expiresAt) return jwtCache.token;
  // iat slightly in the past for clock skew; exp ≤ 10 minutes from now (GitHub limit).
  const iat = now - 60;
  const exp = now + JWT_MAX_TTL_S;
  const token = await signJwt({ iat, exp, iss: appIdNum }, cfg.privateKey);
  jwtCache = { token, expiresAt: now + JWT_MAX_TTL_S - JWT_REFRESH_BEFORE_S };
  return token;
}

const installationCache = new Map<string, { id: number; at: number }>();
const tokenCache = new Map<number, { token: string; expiresAt: number }>();
const INSTALLATION_CACHE_TTL_MS = 5 * 60_000;
const TOKEN_REFRESH_BEFORE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

async function githubFetch(
  url: string,
  token: string,
  opts?: { method?: string; body?: unknown }
): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  let body: string | undefined;
  if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts?.method ?? "GET",
      headers,
      body,
      signal: timeout,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new GitHubError("The GitHub API timed out.", 504);
    }
    throw new GitHubError("Could not reach the GitHub API.", 502);
  }
  if (!res.ok) {
    let ghMessage = "";
    let ghDocs = "";
    try {
      const data = (await res.json()) as { message?: string; documentation_url?: string };
      if (data.message) ghMessage = data.message;
      if (data.documentation_url) ghDocs = data.documentation_url;
    } catch {
      /* ignore */
    }
    let status = 502;
    if (res.status === 401 || res.status === 403) status = 403;
    else if (res.status === 404) status = 404;

    let message = ghMessage || `GitHub API error (status ${res.status}).`;
    if (res.status === 401 || res.status === 403) {
      message +=
        " | Hint: iss must be numeric App ID; private key PEM must be from that same App; " +
        "App must be Installed on the account/org; redeploy Worker after secret put.";
      if (ghDocs) message += ` | docs: ${ghDocs}`;
    }
    throw new GitHubError(`${message} (GitHub ${res.status})`, status);
  }
  return res;
}

async function resolveInstallationId(owner: string, repo: string): Promise<number> {
  const key = `${owner}/${repo}`;
  const cached = installationCache.get(key);
  if (cached && Date.now() - cached.at < INSTALLATION_CACHE_TTL_MS) return cached.id;
  const res = await githubFetch(
    `${getGitHubApiBase()}/repos/${owner}/${repo}/installation`,
    await getAppJwt()
  );
  const data = (await res.json()) as { id?: number };
  if (typeof data.id !== "number") {
    throw new GitHubError(`The GitHub App is not installed on ${owner}/${repo}.`, 404);
  }
  installationCache.set(key, { id: data.id, at: Date.now() });
  return data.id;
}

async function createInstallationToken(installationId: number): Promise<string> {
  const nowMs = Date.now();
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > nowMs + TOKEN_REFRESH_BEFORE_MS) return cached.token;
  const res = await githubFetch(
    `${getGitHubApiBase()}/app/installations/${installationId}/access_tokens`,
    await getAppJwt(),
    { method: "POST", body: {} }
  );
  const data = (await res.json()) as { token?: string; expires_at?: string };
  if (!data.token) throw new GitHubError("GitHub returned an invalid access token.", 502);
  const parsed = data.expires_at ? Date.parse(data.expires_at) : NaN;
  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: Number.isFinite(parsed) ? parsed : nowMs + 60 * 60_000,
  });
  return data.token;
}

export async function getInstallationAccessToken(owner: string, repo: string): Promise<string> {
  return createInstallationToken(await resolveInstallationId(owner, repo));
}

export async function getInstallationTokenById(installationId: number): Promise<string> {
  return createInstallationToken(installationId);
}

export interface InstallationInfo {
  id: number;
  login: string;
  htmlUrl: string;
}

export async function listInstallations(): Promise<InstallationInfo[]> {
  const res = await githubFetch(
    `${getGitHubApiBase()}/app/installations?per_page=100`,
    await getAppJwt()
  );
  const data = (await res.json()) as Array<{
    id?: number;
    account?: { login?: string; html_url?: string };
  }>;
  return data
    .filter((i) => typeof i.id === "number")
    .map((i) => ({
      id: i.id as number,
      login: i.account?.login ?? "unknown",
      htmlUrl: i.account?.html_url ?? "",
    }));
}

export interface RepoSummary {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
}

export async function listInstallationRepositories(installationId: number): Promise<RepoSummary[]> {
  const token = await getInstallationTokenById(installationId);
  const res = await githubFetch(
    `${getGitHubApiBase()}/installation/repositories?per_page=100`,
    token
  );
  const data = (await res.json()) as {
    repositories?: Array<{
      full_name?: string;
      name?: string;
      private?: boolean;
      default_branch?: string;
    }>;
  };
  return (data.repositories ?? []).map((r) => ({
    fullName: r.full_name ?? "unknown",
    name: r.name ?? "unknown",
    private: r.private === true,
    defaultBranch: r.default_branch ?? "main",
  }));
}
