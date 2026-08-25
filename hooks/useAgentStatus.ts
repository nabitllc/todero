// ─── useAgentStatus Hook ──────────────────────────────────────────────────────
// Extracted from AgentOffice.tsx (TOD-476)
// Handles Supabase agent_runs polling and board task polling.

import { useEffect } from 'react';
import { dbUrl, dbRestHeaders } from '@/lib/db/browser';
import { readApiError, formatApiError, type ApiError } from '@/lib/fetch-json';
import type { AgentRunInfo, AgentRunStatus } from '@/components/office/officeConstants';

export type { AgentRunInfo, AgentRunStatus };
export type { ApiError };

// A `status='running'` agent_runs row this old never received a terminal
// status (dispatch died, the process crashed, the machine slept). Treated as
// 'stale' — orphaned, not live — everywhere in the office, so the canvas and
// every sidebar panel agree on what "active" means.
export const RUN_STALE_MS = 5 * 60 * 1000; // 5 minutes

// No per-1k-token price is configured anywhere in this deployment. This used
// to synthesize $0.003/1k (Claude Sonnet's rate, silently applied to every
// agent regardless of which model actually ran) and even charged a flat
// $0.01 for runs with zero recorded tokens. Until a real price is wired in
// (e.g. per-model, from the agent's manifest), cost is reported as `null`
// rather than a fabricated number. Set NEXT_PUBLIC_TOKEN_PRICE_PER_1K to
// opt in once a real price exists.
const TOKEN_PRICE_PER_1K: number | null = (() => {
  const raw = process.env.NEXT_PUBLIC_TOKEN_PRICE_PER_1K;
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : null;
})();

interface RunLikeRow { status?: string | null; started_at?: string | null }

/**
 * The one liveness rule for agent_runs. 'live' only when the row is actively
 * `running` AND started within RUN_STALE_MS — an orphaned `running` row
 * (process died without reporting) is 'stale', never 'live'. A missing row
 * (or one with no started_at) is 'never': the agent hasn't run at all, which
 * must render distinct from a measured idle/ended agent.
 */
export function runLiveness(row: RunLikeRow | null | undefined): AgentRunStatus {
  if (!row || !row.started_at) return 'never';
  const startMs = new Date(row.started_at).getTime();
  if (Number.isNaN(startMs)) return 'never';
  if (row.status === 'running') {
    return (Date.now() - startMs) < RUN_STALE_MS ? 'live' : 'stale';
  }
  return 'ended';
}

/**
 * Fetch the latest agent_runs rows and reduce them to one AgentRunInfo per
 * agent. Throws (with an `.apiError` on the Error) on a failed request
 * instead of silently returning `{}` — a refused query must never be
 * indistinguishable from "no agents have ever run".
 */
export async function fetchAgentRuns(): Promise<Record<string, AgentRunInfo>> {
  const endpoint = dbUrl(`agent_runs?select=agent_id,task_title,status,started_at,tokens_used&order=started_at.desc&limit=200`);
  const res = await fetch(endpoint, { headers: dbRestHeaders() });
  if (!res.ok) {
    const apiError = await readApiError(res, 'agent_runs');
    throw Object.assign(new Error(formatApiError(apiError)), { apiError });
  }
  const rows: any[] = await res.json();
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayMs = todayStart.getTime();
  const result: Record<string, AgentRunInfo> = {};
  const agentRows: Record<string, any[]> = {};
  for (const row of rows) {
    const aid = row.agent_id;
    if (!agentRows[aid]) agentRows[aid] = [];
    agentRows[aid].push(row);
  }
  for (const [aid, aRows] of Object.entries(agentRows)) {
    const latest = aRows[0];
    const st: AgentRunStatus = runLiveness(latest);
    const todayRuns = aRows.filter(r => r.started_at && new Date(r.started_at).getTime() >= todayMs);
    const todayTasks = todayRuns.filter(r => r.status !== 'error').length;
    const todayErrors = todayRuns.filter(r => r.status === 'error').length;
    let estimatedCost: number | null = null;
    if (TOKEN_PRICE_PER_1K != null) {
      const runsWithTokens = todayRuns.filter(r => typeof r.tokens_used === 'number' && r.tokens_used > 0);
      if (runsWithTokens.length > 0) {
        estimatedCost = runsWithTokens.reduce((sum: number, r: any) => sum + (r.tokens_used / 1000) * TOKEN_PRICE_PER_1K, 0);
      }
    }
    result[aid] = { status: st, taskTitle: (latest.task_title || '').slice(0, 35), startedAt: latest.started_at, todayTasks, todayErrors, estimatedCost };
  }
  // TOD (agent-roster-truth): this used to backfill a 'never' entry for a
  // hardcoded 8-agent list (SUPA_AGENTS) so every "known" agent always had a
  // row, whether or not it was in the real roster. Deleted with the rest of
  // that fallback — every caller already treats a *missing* key the same way
  // it treats an explicit 'never' status, so no entry is the honest answer
  // for an agent nothing here was told to expect.
  return result;
}

interface UseAgentStatusOptions {
  simRef: React.MutableRefObject<any>;
  liveRunsRef: React.MutableRefObject<Record<string, AgentRunInfo>>;
  boardTasksRef: React.MutableRefObject<Record<string, string>>;
  subagentCountRef: React.MutableRefObject<number>;
  subagentSessionsRef: React.MutableRefObject<any[]>;
  addFeed: (text: string, color?: string) => void;
  setBoardTasks: (v: Record<string, string>) => void;
}

export function useAgentStatus({
  simRef, liveRunsRef, boardTasksRef, subagentCountRef, subagentSessionsRef,
  addFeed, setBoardTasks,
}: UseAgentStatusOptions) {
  // ── Board task polling ──
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/tasks');
        const data = await res.json();
        if (!Array.isArray(data)) return;
        const map: Record<string, string> = {};
        data.filter((t: any) => t.status === 'in_progress' && t.assignee && t.title)
          .forEach((t: any) => { map[t.assignee] = t.title; });
        boardTasksRef.current = map;
        setBoardTasks({ ...map });
      } catch (e) { }
    };
    fetchTasks();
    const t = setInterval(fetchTasks, 30000);
    return () => clearInterval(t);
  }, [boardTasksRef, setBoardTasks]);

  // ── Supabase agent_runs polling ──
  useEffect(() => {
    let cancelled = false;
    const SUB_AGENT_MAP: Record<string, { name: string; emoji: string; color: string }> = {
      builder: { name: 'Builder', emoji: '🔨', color: '#0984E3' },
      tester: { name: 'Tester', emoji: '🧪', color: '#E84393' },
      deployer: { name: 'Deployer', emoji: '🚀', color: '#00CEC9' },
      scout: { name: 'Scout', emoji: '🔍', color: '#00B894' },
    };
    const pollRuns = async () => {
      try {
        const runs = await fetchAgentRuns();
        if (cancelled) return;
        liveRunsRef.current = runs;
        if (!simRef.current?.agents) return;
        const agents = simRef.current.agents;
        agents.forEach((ag: any) => {
          const run = runs[ag.id];
          if (!run) return;
          if (run.status === 'live') {
            if (ag.state !== 'working') {
              ag.state = 'working'; ag.task = run.taskTitle || 'Working'; ag.progress = 5;
              ag.monologue = null; ag.glowTick = 60; ag.lastStateChange = Date.now();
              addFeed(`${ag.emoji} ${ag.name}: ${run.taskTitle || 'Working'}`, ag.color);
            } else if (ag.state === 'working' && run.taskTitle && ag.task !== run.taskTitle) {
              ag.task = run.taskTitle; ag.progress = 5;
            }
          } else if (run.status === 'ended') {
            if (ag.state === 'working') {
              ag.tasksCompleted++;
              ag.taskHistory = [...(ag.taskHistory || []), ag.task].slice(-20);
              addFeed(`${ag.emoji} ${ag.name}: done`, '#00ff88');
              ag.state = 'idle'; ag.task = null; ag.progress = 0; ag.monologue = null;
              ag.lastStateChange = Date.now();
            }
          } else if (run.status === 'stale') {
            // Orphaned 'running' row — the process died without reporting a
            // terminal status. We do not know whether it succeeded, so we
            // stop showing it as working without claiming "done".
            if (ag.state === 'working') {
              ag.state = 'idle'; ag.task = null; ag.progress = 0; ag.monologue = null;
              ag.lastStateChange = Date.now();
            }
          }
        });
        const subSessions: typeof subagentSessionsRef.current = [];
        for (const [aid, info] of Object.entries(runs)) {
          if (aid === 'main' || !info || info.status !== 'live') continue;
          const meta = SUB_AGENT_MAP[aid];
          if (meta) {
            subSessions.push({ id: aid, ...meta, task: info.taskTitle, startedAt: info.startedAt ? new Date(info.startedAt).getTime() : Date.now() });
          }
        }
        subagentSessionsRef.current = subSessions;
      } catch (e) { }
    };
    pollRuns();
    const t = setInterval(pollRuns, 10000);
    return () => { cancelled = true; clearInterval(t); };
  }, [simRef, liveRunsRef, subagentCountRef, subagentSessionsRef, addFeed]);
}
