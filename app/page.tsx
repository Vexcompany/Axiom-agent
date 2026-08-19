"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

interface Session {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  stickyModelId?: string;
}

const SESSIONS_KEY = "axiom:sessions:v1";
const ACTIVE_KEY = "axiom:active:v1";
const MODEL_KEY = "axiom:model:v1";
const META_PREFIX = "%%%META:";

const MODELS = [
  { id: "auto", label: "Auto (sticky · light first)" },
  { id: "groq/llama-3.1-8b-instant", label: "Groq · Llama 3.1 8B Instant" },
  { id: "groq/openai-gpt-oss-20b", label: "Groq · GPT-OSS 20B" },
  { id: "groq/llama-3.3-70b-versatile", label: "Groq · Llama 3.3 70B" },
  { id: "groq/openai-gpt-oss-120b", label: "Groq · GPT-OSS 120B" },
  { id: "openrouter/free", label: "OpenRouter · Free Router" },
  { id: "openrouter/gemma-4-26b-a4b-it:free", label: "OpenRouter · Gemma 4 26B free" },
  { id: "openrouter/qwen3-8b:free", label: "OpenRouter · Qwen3 8B free" },
  { id: "openrouter/north-mini-code:free", label: "OpenRouter · North Mini Code free" },
  { id: "openrouter/gemma-4-31b-it:free", label: "OpenRouter · Gemma 4 31B free" },
  { id: "openrouter/llama-3.3-70b-instruct:free", label: "OpenRouter · Llama 3.3 70B free" },
  { id: "openrouter/nemotron-3.5-lightning:free", label: "OpenRouter · Nemotron 3.5 Lightning free" },
  { id: "cerebras/gemma-4-31b", label: "Cerebras · Gemma 4 31B" },
  { id: "cerebras/gpt-oss-120b", label: "Cerebras · GPT-OSS 120B" },
  { id: "sekai/free/gpt-5.6-luna", label: "Sekai · GPT-5.6 Luna" },
  { id: "sekai/gcli/grok-4.6", label: "Sekai · Grok 4.6 gcli" },
  { id: "sekai/jb/sekai-flash", label: "Sekai · Flash jb" },
  { id: "sekai/free/grok-4.5", label: "Sekai · Grok 4.5 (often offline)" },
  { id: "sekai/free/grok-4.6", label: "Sekai · Grok 4.6 free (often offline)" },
  { id: "mock", label: "Mock stream (no API)" },
] as const;

const SUGGESTIONS = [
  "Who are you and what can you do?",
  "Draft a system prompt for a coding agent",
  "Explain multi-provider fallback in simple terms",
  "Help me plan v0.2 of an AI agent product",
];

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= 42 ? t || "New chat" : t.slice(0, 39) + "…";
}

function stripMeta(raw: string): { visible: string; modelId: string | null } {
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

function copyText(text: string): Promise<void> {
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

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const lang = /language-([\w-]+)/.exec(className || "")?.[1] ?? "";
  const code = String(children ?? "").replace(/\n$/, "");

  const onCopy = async () => {
    try {
      await copyText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="codeBlock">
      <div className="codeBlockBar">
        <span className="codeLang">{lang || "code"}</span>
        <button type="button" className="codeCopyBtn" onClick={() => void onCopy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
}

const markdownComponents = {
  pre({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  },
  code({
    className,
    children,
    ...props
  }: {
    className?: string;
    children?: ReactNode;
  }) {
    const raw = String(children ?? "");
    const isBlock =
      (typeof className === "string" && className.length > 0) ||
      raw.includes("\n");
    if (!isBlock) {
      return (
        <code className="inlineCode" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  table({ children }: { children?: ReactNode }) {
    return (
      <div className="tableWrap">
        <table>{children}</table>
      </div>
    );
  },
};

function loadSessions(): Session[] {
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

export default function HomePage() {
  const [hydrated, setHydrated] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>("auto");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const busy = isLoading || isStreaming;

  useEffect(() => {
    const list = loadSessions();
    const savedActive = localStorage.getItem(ACTIVE_KEY);
    const savedModel = localStorage.getItem(MODEL_KEY);
    setSessions(list);
    if (savedActive && list.some((s) => s.id === savedActive)) {
      setActiveId(savedActive);
    } else if (list[0]) {
      setActiveId(list[0].id);
    }
    if (savedModel && MODELS.some((m) => m.id === savedModel)) {
      setModel(savedModel);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
      localStorage.setItem(MODEL_KEY, model);
    } catch {
      /* ignore */
    }
  }, [sessions, activeId, model, hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading, isStreaming]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(resizeTextarea, [input, resizeTextarea]);

  const updateSession = useCallback(
    (id: string, updater: (s: Session) => Session) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
    },
    []
  );

  const createSession = useCallback((firstUserText?: string): Session => {
    const session: Session = {
      id: uid(),
      title: firstUserText ? titleFrom(firstUserText) : "New chat",
      updatedAt: Date.now(),
      messages: [],
    };
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    return session;
  }, []);

  const send = useCallback(
    async (_text: string, sessionId: string, history: ChatMessage[]) => {
      setError(null);
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;
      const assistantId = uid();

      const sticky =
        model === "auto"
          ? sessions.find((s) => s.id === sessionId)?.stickyModelId
          : undefined;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            preferredModel: sticky,
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          let msg = `Request failed (${res.status})`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) msg = data.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }

        if (!res.body) throw new Error("Empty response body");

        setIsLoading(false);
        setIsStreaming(true);

        updateSession(sessionId, (s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: [
            ...s.messages,
            { id: assistantId, role: "assistant", content: "" },
          ],
        }));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          const { visible, modelId } = stripMeta(full);

          updateSession(sessionId, (s) => ({
            ...s,
            stickyModelId: modelId ?? s.stickyModelId,
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, content: visible } : m
            ),
          }));
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong. Try again."
        );
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [model, sessions, updateSession]
  );

  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || busy) return;

      setInput("");
      setSidebarOpen(false);

      let sid = activeId;
      let session = active;
      if (!sid || !session) {
        session = createSession(text);
        sid = session.id;
      }

      const userMsg: ChatMessage = { id: uid(), role: "user", content: text };
      const nextMessages = [...(session.messages ?? []), userMsg];

      updateSession(sid, (s) => ({
        ...s,
        title: s.messages.length === 0 ? titleFrom(text) : s.title,
        updatedAt: Date.now(),
        messages: nextMessages,
      }));

      await send(text, sid, nextMessages);
    },
    [input, busy, activeId, active, createSession, updateSession, send]
  );

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    setError(null);
    setIsLoading(false);
    setIsStreaming(false);
    const s = createSession();
    setActiveId(s.id);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  }, [createSession]);

  const handleSelectSession = useCallback((id: string) => {
    abortRef.current?.abort();
    setError(null);
    setIsLoading(false);
    setIsStreaming(false);
    setActiveId(id);
    setSidebarOpen(false);
  }, []);

  const handleDeleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeId]
  );

  const handleRetry = useCallback(async () => {
    if (busy || !activeId || !active) return;
    let history = [...active.messages];
    while (history.length && history[history.length - 1].role !== "user") {
      history = history.slice(0, -1);
    }
    if (!history.length) {
      setError(null);
      return;
    }
    updateSession(activeId, (s) => ({ ...s, messages: history }));
    await send(history[history.length - 1].content, activeId, history);
  }, [busy, activeId, active, updateSession, send]);

  const handleCopyChat = useCallback(async () => {
    if (!active || active.messages.length === 0) return;
    const lines = active.messages.map((m) => {
      const who = m.role === "user" ? "You" : "Axiom";
      return `${who}:\n${m.content}`;
    });
    try {
      await copyText(lines.join("\n\n"));
      setError(null);
    } catch {
      setError("Could not copy chat.");
    }
  }, [active]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleSend();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!hydrated) return <div className="app" />;

  return (
    <div className="app">
      <div
        className={`backdrop${sidebarOpen ? " show" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden
      />

      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sidebarTop">
          <div className="brandRow">
            <div className="brandMark">A</div>
            <div className="brandText">
              <h1>Axiom AI RV</h1>
              <span>v2 · sticky Auto</span>
            </div>
          </div>
          <button type="button" className="newChatBtn" onClick={handleNewChat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New chat
          </button>
        </div>

        <div className="sessionList">
          {sessions.length === 0 && (
            <div style={{ padding: "12px", color: "var(--text-faint)", fontSize: 13 }}>
              No chats yet
            </div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sessionItem${s.id === activeId ? " active" : ""}`}
              onClick={() => handleSelectSession(s.id)}
            >
              <span className="sessionTitle">{s.title}</span>
              <span
                className="sessionDelete"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSession(s.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    handleDeleteSession(s.id);
                  }
                }}
                aria-label="Delete chat"
              >
                ×
              </span>
            </button>
          ))}
        </div>

        <div className="sidebarFoot">
          {model === "auto" && active?.stickyModelId
            ? `Auto locked: ${active.stickyModelId}`
            : "Auto sticks to the first working model in this chat"}
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <button
            type="button"
            className="menuBtn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="topbarTitle">{active?.title ?? "Axiom AI RV"}</div>
          <select
            className="modelSelect"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="iconBtn"
            onClick={() => void handleCopyChat()}
            disabled={!active || active.messages.length === 0}
            title="Copy full chat"
            aria-label="Copy full chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </header>

        {messages.length === 0 ? (
          <div className="empty">
            <div className="emptyMark">A</div>
            <h2>Axiom AI RV</h2>
            <p>
              Auto picks a light free model once, then stays on it for the rest of
              the chat so answers stay consistent.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="suggestion"
                  onClick={() => void handleSend(s)}
                  disabled={busy}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            <div className="messagesInner">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  <span className="msgLabel">
                    {m.role === "user" ? "You" : "Axiom"}
                  </span>
                  <div className="msgBody">
                    {m.role === "assistant" ? (
                      m.content ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents as any}
                        >
                          {m.content}
                        </ReactMarkdown>
                      ) : (
                        <div className="typing" aria-label="Thinking">
                          <span />
                          <span />
                          <span />
                        </div>
                      )
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="msg assistant">
                  <span className="msgLabel">Axiom</span>
                  <div className="msgBody">
                    <div className="typing" aria-label="Thinking">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="errorBanner" role="alert">
                  <span>{error}</span>
                  <button type="button" className="retryBtn" onClick={() => void handleRetry()}>
                    Retry
                  </button>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>
        )}

        <div className="composerWrap">
          <form className="composer" onSubmit={onSubmit}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message Axiom AI RV…"
              rows={1}
              aria-label="Message Axiom"
            />
            <button
              type="submit"
              className="sendBtn"
              disabled={busy || input.trim().length === 0}
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            </button>
          </form>
          <p className="hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </section>
    </div>
  );
}
