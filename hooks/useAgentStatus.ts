// ─── useAgentStatus Hook ──────────────────────────────────────────────────────
// Extracted from AgentOffice.tsx (TOD-476)
// Handles Supabase agent_runs polling and board task polling.

import { useEffect } from 'react';
import { SUPA_AGENTS } from '@/components/office/officeConstants';
import { dbRestBase, dbRestHeaders } from '@/lib/db/browser';
import type { AgentRunInfo, AgentRunStatus } from '@/components/office/officeConstants';

export type { AgentRunInfo, AgentRunStatus };

export async function fetchAgentRuns(): Promise<Record<string, AgentRunInfo>> {
  const res = await fetch(
    `${dbRestBase()}/rest/v1/agent_runs?select=agent_id,task_title,status,started_at,tokens_used&order=started_at.desc&limit=200`,
    { headers: dbRestHeaders() }
  );
  if (!res.ok) return {};
  const rows: any[] = await res.json();
  const now = Date.now();
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
    const startMs = latest.started_at ? new Date(latest.started_at).getTime() : 0;
    const ageMin = (now - startMs) / 60000;
    const st: AgentRunStatus = (latest.status === 'running' || ageMin < 5) ? 'working' : 'idle';
    const todayRuns = aRows.filter(r => r.started_at && new Date(r.started_at).getTime() >= todayMs);
    const todayTasks = todayRuns.filter(r => r.status !== 'error').length;
    const todayErrors = todayRuns.filter(r => r.status === 'error').length;
    const estimatedCost = todayRuns.reduce((sum: number, r: any) => sum + (r.tokens_used ? (r.tokens_used / 1000) * 0.003 : 0.01), 0);
    result[aid] = { status: st, taskTitle: (latest.task_title || '').slice(0, 35), startedAt: latest.started_at, todayTasks, todayErrors, estimatedCost };
  }
  for (const id of SUPA_AGENTS) {
    if (!result[id]) result[id] = { status: 'never', taskTitle: '', startedAt: null, todayTasks: 0, todayErrors: 0, estimatedCost: 0 };
  }
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
          if (run.status === 'working') {
            if (ag.state !== 'working' && ag.state !== 'meeting' && ag.state !== 'moving_to_meeting') {
              ag.state = 'working'; ag.task = run.taskTitle || 'Working'; ag.progress = 5;
              ag.monologue = null; ag.glowTick = 60; ag.lastStateChange = Date.now();
              addFeed(`${ag.emoji} ${ag.name}: ${run.taskTitle || 'Working'}`, ag.color);
            } else if (ag.state === 'working' && run.taskTitle && ag.task !== run.taskTitle) {
              ag.task = run.taskTitle; ag.progress = 5;
            }
          } else if (run.status === 'idle') {
            if (ag.state === 'working') {
              ag.tasksCompleted++;
              ag.taskHistory = [...(ag.taskHistory || []), ag.task].slice(-20);
              addFeed(`${ag.emoji} ${ag.name}: done`, '#00ff88');
              ag.state = 'idle'; ag.task = null; ag.progress = 0; ag.monologue = null;
              ag.lastStateChange = Date.now();
            }
          }
        });
        const subSessions: typeof subagentSessionsRef.current = [];
        for (const [aid, info] of Object.entries(runs)) {
          if (aid === 'main' || !info || info.status !== 'working') continue;
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
