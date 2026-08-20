import {
  AIProvider,
  ChatMessage,
  ParsedToolCall,
  ToolDefinition,
} from "@/lib/ai/types";
import { executeGitHubTool } from "@/lib/github/tools";

/**
 * Server-side agent loop: model <-> tools. 
 */

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; ok: boolean };

export interface RunChatOptions {
  signal?: AbortSignal;
  maxToolRounds?: number;
  maxToolCalls?: number;
}

const MAX_TOOL_OUTPUT_CHARS = 60_000;
const MAX_CONVERSATION_MESSAGES = 80;

function capToolOutput(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT_CHARS) return s;
  const omitted = s.length - MAX_TOOL_OUTPUT_CHARS;
  return `${s.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n\n[Result truncated: ${omitted} characters omitted.]`;
}

function trimConversation(conversation: ChatMessage[]): void {
  if (conversation.length <= MAX_CONVERSATION_MESSAGES) return;
  let start = conversation.length - MAX_CONVERSATION_MESSAGES;
  while (start > 1 && conversation[start]?.role === "tool") start -= 1;
  const kept = [conversation[0], ...conversation.slice(start)];
  conversation.splice(0, conversation.length, ...kept);
}

export async function* runChat(
  provider: AIProvider,
  messages: ChatMessage[],
  tools: readonly ToolDefinition[],
  opts?: RunChatOptions
): AsyncGenerator<AgentEvent, void, unknown> {
  const maxToolRounds = opts?.maxToolRounds ?? 8;
  const maxToolCalls = opts?.maxToolCalls ?? 24;
  const toolDefs = tools.length > 0 ? [...tools] : undefined;

  const conversation: ChatMessage[] = [...messages];
  let toolCallsExecuted = 0;

  for (let round = 0; ; round++) {
    if (round > maxToolRounds) {
      yield {
        type: "text",
        text: "\n\n_(Stopped after too many tool rounds. Please narrow the request.)_",
      };
      return;
    }
    if (round > 0) trimConversation(conversation);

    let calls: ParsedToolCall[] | null = null;
    const textParts: string[] = [];
    let responded = false;

    for await (const chunk of provider.streamChat(conversation, {
      signal: opts?.signal,
      tools: toolDefs,
    })) {
      if (chunk.type === "text") {
        responded = true;
        textParts.push(chunk.text);
        yield { type: "text", text: chunk.text };
      } else if (chunk.type === "reasoning") {
        responded = true;
      } else if (chunk.type === "tool_calls") {
        responded = true;
        calls = chunk.calls;
      }
    }

    const finalText = textParts.join("");

    if (!calls || calls.length === 0) {
      if (textParts.length === 0 && !responded) {
        yield {
          type: "text",
          text: "(The model returned an empty response.)",
        };
      }
      return;
    }

    conversation.push({
      role: "assistant",
      content: finalText,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.rawArguments },
      })),
    });

    let executedThisRound = 0;
    for (const call of calls) {
      if (toolCallsExecuted >= maxToolCalls) break;
      const result = await executeGitHubTool(call);
      toolCallsExecuted += 1;
      executedThisRound += 1;
      yield { type: "tool", tool: call.name, ok: result.ok };

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: capToolOutput(result.output),
      });
    }

    if (executedThisRound === 0 || toolCallsExecuted >= maxToolCalls) {
      yield {
        type: "text",
        text: "\n\n_(Stopped after too many tool calls. Please narrow the request.)_",
      };
      return;
    }
  }
}
