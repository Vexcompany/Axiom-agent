export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  stickyModelId?: string;
}

export const SESSIONS_KEY = "axiom:sessions:v1";
export const ACTIVE_KEY = "axiom:active:v1";
export const MODEL_KEY = "axiom:model:v1";
export const META_PREFIX = "%%%META:";

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= 42 ? t || "New chat" : t.slice(0, 39) + "…";
}

export function stripMeta(raw: string): { visible: string; modelId: string | null } {
  let modelId: string | null = null;
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith(META_PREFIX)) {
      const id = line.slice(META_PREFIX.length).trim();
      if (id) modelId = id;
      continue;
    }
    kept.push(line);
  }
  return { visible: kept.join("\n"), modelId };
}

export function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

export function sessionToMarkdown(session: Session): string {
  const header = [
    `# ${session.title}`,
    "",
    `_Exported from Axiom AI RV · ${new Date(session.updatedAt).toISOString()}_`,
    session.stickyModelId ? `_Model: ${session.stickyModelId}_` : null,
    "",
    "---",
    "",
  ]
    .filter((x) => x !== null)
    .join("\n");

  const body = session.messages
    .map((m) => {
      const who = m.role === "user" ? "You" : "Axiom";
      return `### ${who}\n\n${m.content.trim()}\n`;
    })
    .join("\n");

  return header + body;
}

export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Session =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Session).id === "string" &&
        typeof (s as Session).title === "string" &&
        Array.isArray((s as Session).messages)
    );
  } catch {
    return [];
  }
} 
