import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import { isGitHubConfigured } from "@/lib/github/auth";
import { compactMessages } from "@/lib/memory/compact";
import { autoCandidates, findCatalogModel } from "./catalog";
import { streamOpenAICompatible } from "./openaiCompatible";
import type { CatalogModel, ChatMessage, ProviderId } from "./types";
import { ProviderError } from "./types";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

export function isProviderConfigured(provider: ProviderId): boolean {
  switch (provider) {
    case "groq":
      return Boolean(env("GROQ_API_KEY"));
    case "openrouter":
      return Boolean(env("OPENROUTER_API_KEY"));
    case "cerebras":
      return Boolean(env("CEREBRAS_API_KEY"));
    case "sekai":
      return Boolean(env("SEKAI_API_KEY") && env("SEKAI_BASE_URL"));
    case "google":
      return Boolean(env("GEMINI_API_KEY") || env("GOOGLE_API_KEY"));
    case "mock":
      return true;
    default:
      return false;
  }
}

export function anyRealProviderConfigured(): boolean {
  return (
    isProviderConfigured("groq") ||
    isProviderConfigured("openrouter") ||
    isProviderConfigured("cerebras") ||
    isProviderConfigured("sekai") ||
    isProviderConfigured("google")
  );
}

function resolveEndpoint(provider: ProviderId): {
  baseUrl: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
} {
  switch (provider) {
    case "groq": {
      const key = env("GROQ_API_KEY");
      if (!key) throw new ProviderError("GROQ_API_KEY missing", 503, "config", "groq");
      return {
        baseUrl: env("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1",
        apiKey: key,
      };
    }
    case "openrouter": {
      const key = env("OPENROUTER_API_KEY");
      if (!key)
        throw new ProviderError("OPENROUTER_API_KEY missing", 503, "config", "openrouter");
      return {
        baseUrl: env("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
        apiKey: key,
        extraHeaders: {
          "HTTP-Referer": env("OPENROUTER_SITE_URL") ?? "https://axiom-agent.local",
          "X-Title": env("OPENROUTER_APP_NAME") ?? "Axiom AI RV",
        },
      };
    }
    case "cerebras": {
      const key = env("CEREBRAS_API_KEY");
      if (!key)
        throw new ProviderError("CEREBRAS_API_KEY missing", 503, "config", "cerebras");
      return {
        baseUrl: env("CEREBRAS_BASE_URL") ?? "https://api.cerebras.ai/v1",
        apiKey: key,
      };
    }
    case "sekai": {
      const key = env("SEKAI_API_KEY");
      const base = env("SEKAI_BASE_URL");
      if (!key || !base)
        throw new ProviderError("SEKAI credentials missing", 503, "config", "sekai");
      return { baseUrl: base, apiKey: key };
    }
    case "google": {
      const key = env("GEMINI_API_KEY") || env("GOOGLE_API_KEY");
      if (!key)
        throw new ProviderError("GEMINI_API_KEY missing", 503, "config", "google");
      return {
        baseUrl:
          env("GEMINI_BASE_URL") ??
          "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: key,
      };
    }
    default:
      throw new ProviderError(`Unknown provider: ${provider}`, 500, "config");
  }
}

export function resolveChain(
  requestedModel: string,
  preferredModel?: string
): CatalogModel[] {
  if (requestedModel === "auto") {
    let chain = autoCandidates().filter((m) => isProviderConfigured(m.provider));
    if (preferredModel) {
      const pref = findCatalogModel(preferredModel);
      if (pref && pref.provider !== "mock" && isProviderConfigured(pref.provider)) {
        chain = [pref, ...chain.filter((m) => m.id !== pref.id)];
      }
    }
    return chain;
  }

  const found = findCatalogModel(requestedModel);
  if (found && found.provider !== "mock") {
    if (!isProviderConfigured(found.provider)) return [];
    return [found];
  }
  return autoCandidates().filter((m) => isProviderConfigured(m.provider));
}

export async function* streamWithFallback(
  requestedModel: string,
  userMessages: ChatMessage[],
  opts?: {
    signal?: AbortSignal;
    preferredModel?: string;
    existingMemory?: string;
    enableGitHubTools?: boolean;
  }
): AsyncGenerator<
  { type: "text"; text: string } | { type: "meta"; modelId: string },
  void,
  unknown
> {
  const chain = resolveChain(requestedModel, opts?.preferredModel);
  if (chain.length === 0) {
    throw new ProviderError(
      "No provider configured. Set GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, or SEKAI_* env vars.",
      503,
      "config"
    );
  }

  const maxTokens = positiveInt(env("AXIOM_MAX_TOKENS"), 1536);
  const keepRecent = positiveInt(env("AXIOM_KEEP_RECENT"), 12);

  const { recent, memorySummary } = compactMessages(userMessages, {
    keepRecent,
    existingSummary: opts?.existingMemory,
  });

  const system = buildSystemPrompt({
    githubConnected: isGitHubConfigured() && opts?.enableGitHubTools === true,
    toolsActive: false,
    memorySummary: memorySummary || undefined,
  });

  const conversation: ChatMessage[] = [
    { role: "system", content: system },
    ...recent,
  ];

  let lastErr: string | null = null;

  for (const model of chain) {
    if (opts?.signal?.aborted) return;
    try {
      const endpoint = resolveEndpoint(model.provider);
      let produced = false;
      for await (const chunk of streamOpenAICompatible({
        ...endpoint,
        model: model.upstreamModel,
        messages: conversation,
        provider: model.provider,
        signal: opts?.signal,
        maxTokens,
      })) {
        if (!produced) {
          produced = true;
          yield { type: "meta", modelId: model.id };
        }
        yield { type: "text", text: chunk };
      }
      if (produced) return;
      lastErr = `${model.label}: empty response`;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg =
        err instanceof ProviderError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upstream error";
      lastErr = `${model.label}: ${msg}`;
      continue;
    }
  }

  throw new ProviderError(
    lastErr ?? "All providers failed. Try another model.",
    502,
    "all_failed"
  );
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
