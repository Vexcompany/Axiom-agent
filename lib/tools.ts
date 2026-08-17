import { tool } from 'ai';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export const githubTools = {
  listRepos: tool({
    description: 'List repositories for a GitHub user',
    parameters: z.object({
      username: z.string().describe('GitHub username'),
    }),
    execute: async ({ username }) => {
      const { data } = await octokit.repos.listForUser({ username, per_page: 10 });
      return data.map(r => ({
        name: r.name,
        description: r.description,
        stars: r.stargazers_count,
        url: r.html_url,
      }));
    },
  }),

  getRepo: tool({
    description: 'Get detailed information about a specific GitHub repository',
    parameters: z.object({
      owner: z.string(),
      repo: z.string(),
    }),
    execute: async ({ owner, repo }) => {
      const { data } = await octokit.repos.get({ owner, repo });
      return {
        name: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        language: data.language,
        url: data.html_url,
      };
    },
  }),

  createIssue: tool({
    description: 'Create an issue in a GitHub repository',
    parameters: z.object({
      owner: z.string(),
      repo: z.string(),
      title: z.string(),
      body: z.string().optional(),
    }),
    execute: async ({ owner, repo, title, body }) => {
      const { data } = await octokit.issues.create({ owner, repo, title, body });
      return { number: data.number, url: data.html_url };
    },
  }),
};

export const vercelTools = {
  listDeployments: tool({
    description: 'List recent Vercel deployments',
    parameters: z.object({
      projectId: z.string().optional(),
    }),
    execute: async ({ projectId }) => {
      const url = new URL('https://api.vercel.com/v6/deployments');
      if (projectId) url.searchParams.set('projectId', projectId);
      url.searchParams.set('limit', '10');

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
      });
      const data = await res.json();
      return data.deployments?.map((d: any) => ({
        url: d.url,
        state: d.state,
        created: new Date(d.created).toISOString(),
        target: d.target,
      }));
    },
  }),

  getProjectInfo: tool({
    description: 'Get information about a Vercel project',
    parameters: z.object({
      projectId: z.string(),
    }),
    execute: async ({ projectId }) => {
      const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
      });
      return await res.json();
    },
  }),
};