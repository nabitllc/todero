/*
  What landed on main: merged pull requests, plus commits pushed straight to
  main that belong to no PR (much of the early work). Server-side only,
  cached five minutes. The token never leaves the server.
*/
import { parseBody, type ParsedBody } from "./parse";

const REPO = "nabitllc/todero";
const API = `https://api.github.com/repos/${REPO}`;
const DAYS = 90;
const REVALIDATE = 300;
const CONCURRENCY = 6;

export type Area = "site" | "app" | "both";

export interface Entry extends ParsedBody {
  kind: "pr" | "commit";
  /** "#42" for a PR, the short SHA for a direct commit. */
  label: string;
  title: string;
  url: string;
  author: string;
  /** Merge time for PRs, commit time for direct commits. */
  at: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  topFiles: string[];
  area: Area;
  draft: boolean;
}

interface PullListItem {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  merged_at: string | null;
  created_at: string;
  body: string | null;
  draft: boolean;
  merge_commit_sha: string | null;
}

interface PullDetail extends PullListItem {
  additions: number;
  deletions: number;
  changed_files: number;
}

interface FileStat {
  filename: string;
  additions: number;
  deletions: number;
}

interface CommitListItem {
  sha: string;
  html_url: string;
  commit: { message: string; author: { date: string } | null };
  author: { login: string } | null;
  parents: Array<{ sha: string }>;
}

interface CommitDetail extends CommitListItem {
  stats: { additions: number; deletions: number };
  files: FileStat[];
}

async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    next: { revalidate: REVALIDATE },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export function areaOf(files: string[]): Area {
  if (files.length === 0) return "site";
  const inApp = files.filter((f) => f.startsWith("local/")).length;
  if (inApp === 0) return "site";
  if (inApp === files.length) return "app";
  return "both";
}

function topFilesOf(files: FileStat[]): string[] {
  return [...files]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, 3)
    .map((f) => f.filename);
}

async function mapLimit<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function pullEntry(token: string, item: PullListItem): Promise<Entry> {
  const [detail, files] = await Promise.all([
    gh<PullDetail>(token, `/pulls/${item.number}`),
    gh<FileStat[]>(token, `/pulls/${item.number}/files?per_page=100`),
  ]);
  return {
    kind: "pr",
    label: `#${item.number}`,
    title: item.title,
    url: item.html_url,
    author: item.user?.login ?? "unknown",
    at: item.merged_at ?? item.created_at,
    additions: detail.additions,
    deletions: detail.deletions,
    changedFiles: detail.changed_files,
    topFiles: topFilesOf(files),
    area: areaOf(files.map((f) => f.filename)),
    draft: item.draft,
    ...parseBody(item.body),
  };
}

function isNoise(message: string): boolean {
  return /^checkpoint:/i.test(message) || /^Merge (pull request|branch)/i.test(message);
}

async function commitEntry(token: string, item: CommitListItem): Promise<Entry> {
  const detail = await gh<CommitDetail>(token, `/commits/${item.sha}`);
  const [title, ...rest] = item.commit.message.split("\n");
  return {
    kind: "commit",
    label: item.sha.slice(0, 7),
    title: title.trim(),
    url: item.html_url,
    author: item.author?.login ?? "unknown",
    at: item.commit.author?.date ?? new Date(0).toISOString(),
    additions: detail.stats.additions,
    deletions: detail.stats.deletions,
    changedFiles: detail.files.length,
    topFiles: topFilesOf(detail.files),
    area: areaOf(detail.files.map((f) => f.filename)),
    draft: false,
    ...parseBody(rest.join("\n")),
  };
}

/** Merged PRs and direct commits on main from the last 90 days, newest first. */
export async function landed(token: string, now = Date.now()): Promise<Entry[]> {
  const since = new Date(now - DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [closed, commits] = await Promise.all([
    gh<PullListItem[]>(token, "/pulls?state=closed&sort=updated&direction=desc&per_page=100"),
    gh<CommitListItem[]>(token, `/commits?sha=main&since=${since}&per_page=100`),
  ]);
  const merged = closed.filter((p) => p.merged_at && p.merged_at >= since);

  // Commits that arrived through a PR are the PR's; skip them as direct entries.
  const viaPr = new Set<string>();
  const prCommits = await mapLimit(merged, (p) => gh<Array<{ sha: string }>>(token, `/pulls/${p.number}/commits?per_page=100`));
  for (const list of prCommits) for (const c of list) viaPr.add(c.sha);
  for (const p of merged) if (p.merge_commit_sha) viaPr.add(p.merge_commit_sha);

  const direct = commits.filter((c) => !viaPr.has(c.sha) && c.parents.length === 1 && !isNoise(c.commit.message));

  const entries = await Promise.all([mapLimit(merged, (p) => pullEntry(token, p)), mapLimit(direct, (c) => commitEntry(token, c))]);
  return entries.flat().sort((a, b) => b.at.localeCompare(a.at));
}

export async function openPulls(token: string): Promise<Entry[]> {
  const list = await gh<PullListItem[]>(token, "/pulls?state=open&sort=created&direction=desc&per_page=50");
  return mapLimit(list, (p) => pullEntry(token, p));
}
