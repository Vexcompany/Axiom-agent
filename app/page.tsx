"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AssistantMarkdown } from "@/app/components/Markdown";
import { GithubToolsToggle } from "@/app/components/GithubToolsToggle";
import {
  type ChatMessage,
  type Session,
  ACTIVE_KEY,
  MODEL_KEY,
  SESSIONS_KEY,
  copyText,
  downloadMarkdown,
  loadSessions,
  sessionToMarkdown,
  stripMeta,
  titleFrom,
  uid,
} from "@/lib/chatUtils";

const GH_TOOLS_KEY = "axiom.v2.githubTools";

const MODELS = [
  { id: "auto", label: "Auto (sticky · light first)" },
  { id: "gemini/gemini-2.5-flash", label: "Google · Gemini 2.5 Flash (15 RPM)" },
  { id: "groq/openai-gpt-oss-20b", label: "Groq · GPT-OSS 20B" },
  { id: "groq/openai-gpt-oss-120b", label: "Groq · GPT-OSS 120B" },
  { id: "groq/qwen3.6-27b", label: "Groq · Qwen3.6 27B" },
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

function makeSession(firstUserText?: string): Session {
  return {
    id: uid(),
    title: firstUserText ? titleFrom(firstUserText) : "New chat",
    updatedAt: Date.now(),
    messages: [],
  };
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
  const [githubTools, setGithubTools] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<number | null>(null);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const busy = isLoading || isStreaming;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  useEffect(() => {
    const list = loadSessions();
    const savedActive = localStorage.getItem(ACTIVE_KEY);
    const savedModel = localStorage.getItem(MODEL_KEY);
    setSessions(list);
    if (savedActive && list.some((s) => s.id === savedActive)) setActiveId(savedActive);
    else if (list[0]) setActiveId(list[0].id);
    if (savedModel && MODELS.some((m) => m.id === savedModel)) setModel(savedModel);
    try {
      setGithubTools(localStorage.getItem(GH_TOOLS_KEY) === "1");
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(GH_TOOLS_KEY, githubTools ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [hydrated, githubTools]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
      localStorage.setItem(MODEL_KEY, model);
    } catch { /* ignore */ }
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

  const updateSession = useCallback((id: string, updater: (s: Session) => Session) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }, []);

  const createSession = useCallback((firstUserText?: string): Session => {
    const session = makeSession(firstUserText);
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    return session;
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setIsStreaming(false);
    showToast("Stopped");
  }, [showToast]);

  const send = useCallback(
    async (_text: string, sessionId: string, history: ChatMessage[]) => {
      setError(null);
      setIsLoading(true);
      setEditingId(null);
      const controller = new AbortController();
      abortRef.current = controller;
      const assistantId = uid();
      const sticky = model === "auto" ? sessions.find((s) => s.id === sessionId)?.stickyModelId : undefined;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            preferredModel: sticky,
            enableGitHubTools: githubTools,
            messages: history.map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          let msg = `Request failed (${res.status})`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) msg = data.error;
          } catch { /* ignore */ }
          throw new Error(msg);
        }
        if (!res.body) throw new Error("Empty response body");
        setIsLoading(false);
        setIsStreaming(true);
        updateSession(sessionId, (s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: [...s.messages, { id: assistantId, role: "assistant", content: "" }],
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
            messages: s.messages.map((m) => (m.id === assistantId ? { ...m, content: visible } : m)),
          }));
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [model, githubTools, sessions, updateSession]
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
    setEditingId(null);
    setActiveId(createSession().id);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  }, [createSession]);

  const handleSelectSession = useCallback((id: string) => {
    abortRef.current?.abort();
    setError(null);
    setIsLoading(false);
    setIsStreaming(false);
    setEditingId(null);
    setActiveId(id);
    setSidebarOpen(false);
  }, []);

  const handleDeleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }, [activeId]);

  const handleRetry = useCallback(async () => {
    if (busy || !activeId || !active) return;
    let history = [...active.messages];
    while (history.length && history[history.length - 1].role !== "user") history = history.slice(0, -1);
    if (!history.length) { setError(null); return; }
    updateSession(activeId, (s) => ({ ...s, messages: history }));
    await send(history[history.length - 1].content, activeId, history);
  }, [busy, activeId, active, updateSession, send]);

  const handleCopyMessage = useCallback(async (msg: ChatMessage) => {
    try {
      await copyText(msg.content);
      setCopiedMsgId(msg.id);
      window.setTimeout(() => setCopiedMsgId(null), 1600);
    } catch { setError("Could not copy message."); }
  }, []);

  const handleCopyChat = useCallback(async () => {
    if (!active || active.messages.length === 0) return;
    try {
      await copyText(active.messages.map((m) => `${m.role === "user" ? "You" : "Axiom"}:\n${m.content}`).join("\n\n"));
      showToast("Chat copied");
    } catch { setError("Could not copy chat."); }
  }, [active, showToast]);

  const handleExportMarkdown = useCallback(() => {
    if (!active || active.messages.length === 0) return;
    const safe = active.title.replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 48);
    downloadMarkdown(`${safe || "axiom-chat"}.md`, sessionToMarkdown(active));
    showToast("Exported .md");
  }, [active, showToast]);

  const startEdit = useCallback((msg: ChatMessage) => {
    if (msg.role !== "user") return;
    setEditingId(msg.id);
    setEditDraft(msg.content);
  }, []);

  const cancelEdit = useCallback(() => { setEditingId(null); setEditDraft(""); }, []);

  const submitEdit = useCallback(async () => {
    if (busy || !activeId || !active || !editingId) return;
    const text = editDraft.trim();
    if (!text) return;
    const idx = active.messages.findIndex((m) => m.id === editingId);
    if (idx < 0) return;
    const history: ChatMessage[] = active.messages.slice(0, idx).concat([{ id: editingId, role: "user", content: text }]);
    setEditingId(null);
    setEditDraft("");
    setError(null);
    updateSession(activeId, (s) => ({
      ...s,
      title: idx === 0 ? titleFrom(text) : s.title,
      updatedAt: Date.now(),
      messages: history,
    }));
    await send(text, activeId, history);
  }, [busy, activeId, active, editingId, editDraft, updateSession, send]);

  if (!hydrated) return <div className="app" />;

  return (
    <div className="app">
      <div className={`backdrop${sidebarOpen ? " show" : ""}`} onClick={() => setSidebarOpen(false)} aria-hidden />
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sidebarTop">
          <div className="brandRow">
            <div className="brandMark">A</div>
            <div className="brandText"><h1>Axiom AI RV</h1><span>v2 · sticky Auto</span></div>
          </div>
          <button type="button" className="newChatBtn" onClick={handleNewChat}>New chat</button>
        </div>
        <div className="sessionList">
          {sessions.length === 0 && <div style={{ padding: 12, color: "var(--text-faint)", fontSize: 13 }}>No chats yet</div>}
          {sessions.map((s) => (
            <button key={s.id} type="button" className={`sessionItem${s.id === activeId ? " active" : ""}`} onClick={() => handleSelectSession(s.id)}>
              <span className="sessionTitle">{s.title}</span>
              <span className="sessionDelete" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }} aria-label="Delete chat">×</span>
            </button>
          ))}
        </div>
        <div className="sidebarFoot">
          {model === "auto" && active?.stickyModelId ? `Auto locked: ${active.stickyModelId}` : "Auto sticks to the first working model in this chat"}
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <button type="button" className="menuBtn" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">☰</button>
          <div className="topbarTitle">{active?.title ?? "Axiom AI RV"}</div>
          <select className="modelSelect" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <GithubToolsToggle checked={githubTools} onChange={setGithubTools} disabled={busy} />
          <button type="button" className="iconBtn" onClick={() => void handleCopyChat()} disabled={!active || active.messages.length === 0} title="Copy full chat">⧉</button>
          <button type="button" className="iconBtn" onClick={handleExportMarkdown} disabled={!active || active.messages.length === 0} title="Export Markdown">↓</button>
        </header>

        {messages.length === 0 ? (
          <div className="empty">
            <div className="emptyMark">A</div>
            <h2>Axiom AI RV</h2>
            <p>Auto picks a light free model once, then stays on it for the rest of the chat so answers stay consistent.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="suggestion" onClick={() => void handleSend(s)} disabled={busy}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            <div className="messagesInner">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  <span className="msgLabel">{m.role === "user" ? "You" : "Axiom"}</span>
                  <div className="msgBody">
                    {editingId === m.id ? (
                      <div className="editBox">
                        <textarea className="editArea" value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={4} autoFocus />
                        <div className="editActions">
                          <button type="button" className="msgActionBtn" onClick={cancelEdit} disabled={busy}>Cancel</button>
                          <button type="button" className="msgActionBtn primary" onClick={() => void submitEdit()} disabled={busy || !editDraft.trim()}>Save & resend</button>
                        </div>
                      </div>
                    ) : m.role === "assistant" ? (
                      m.content ? <AssistantMarkdown content={m.content} /> : <div className="typing" aria-label="Thinking"><span /><span /><span /></div>
                    ) : m.content}
                  </div>
                  {editingId !== m.id && m.content ? (
                    <div className="msgActions">
                      <button type="button" className="msgActionBtn" onClick={() => void handleCopyMessage(m)}>{copiedMsgId === m.id ? "Copied" : "Copy"}</button>
                      {m.role === "user" ? <button type="button" className="msgActionBtn" onClick={() => startEdit(m)} disabled={busy}>Edit</button> : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {isLoading && (
                <div className="msg assistant">
                  <span className="msgLabel">Axiom</span>
                  <div className="msgBody"><div className="typing" aria-label="Thinking"><span /><span /><span /></div></div>
                </div>
              )}
              {error && (
                <div className="errorBanner" role="alert">
                  <span>{error}</span>
                  <button type="button" className="retryBtn" onClick={() => void handleRetry()}>Retry</button>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        )}

        <div className="composerWrap">
          <form className="composer" onSubmit={(e: FormEvent) => { e.preventDefault(); void handleSend(); }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
              }}
              placeholder="Message Axiom AI RV…"
              rows={1}
              aria-label="Message Axiom"
              disabled={busy}
            />
            {busy ? (
              <button type="button" className="stopBtn" onClick={handleStop} aria-label="Stop" title="Stop">■</button>
            ) : (
              <button type="submit" className="sendBtn" disabled={input.trim().length === 0} aria-label="Send">↑</button>
            )}
          </form>
          <p className="hint">Enter to send · Shift+Enter new line · Stop while streaming · GitHub tools off by default</p>
        </div>
      </section>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
} 
