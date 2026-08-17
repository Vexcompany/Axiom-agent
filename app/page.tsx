'use client';

import { useChat } from 'ai/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="border-b border-neutral-800 p-4">
        <h1 className="text-xl font-semibold">AI Agent — GitHub × Vercel</h1>
        <p className="text-sm text-neutral-400">Ask about repos, issues, deployments…</p>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl w-full mx-auto">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
              m.role === 'user' ? 'bg-blue-600' : 'bg-neutral-800'
            }`}>
              <div className="text-xs text-neutral-400 mb-1">{m.role}</div>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.toolInvocations?.map((t, i) => (
                <div key={i} className="mt-2 text-xs bg-neutral-900 rounded p-2 font-mono">
                  🔧 {t.toolName}({JSON.stringify(t.args)})
                </div>
              ))}
            </div>
          </div>
        ))}
        {isLoading && <div className="text-neutral-500 text-sm">thinking…</div>}
      </main>

      <form onSubmit={handleSubmit} className="border-t border-neutral-800 p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="e.g. list my repos for user 'vercel'"
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-2 outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl px-6 py-2 font-medium"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}