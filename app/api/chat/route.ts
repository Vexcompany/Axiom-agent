import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { githubTools, vercelTools } from '@/lib/tools';

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: `You are a helpful AI agent with access to GitHub and Vercel tools.
When users ask about repos, issues, or deployments, use the appropriate tool.
Always respond in the user's language (Indonesian if they use Indonesian).`,
    messages,
    tools: { ...githubTools, ...vercelTools },
    maxSteps: 5,
  });

  return result.toDataStreamResponse();
}