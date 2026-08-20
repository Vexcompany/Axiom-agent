"use client";

import { type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText } from "@/lib/chatUtils";

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

const components = {
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

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as any}>
      {content}
    </ReactMarkdown>
  );
}
