export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Reads from the agent_runs table.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/hub-client';
import { dbUnavailableResponse } from '@/lib/db-http'

const AGENT_IDS = ['builder', 'po', 'tester', 'ops', 'deployer', 'auditor', 'main', 'scout'];

async function getAgentTaskMap(): Promise<Record<string, string>> {
  try {
    const db = createAdminClient();
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h window

    const { data: runs, error } = await db
      .from('agent_runs')
      .select('agent_id, status, started_at, task_title')
      .in('agent_id', AGENT_IDS)
      .gte('started_at', cutoff)
      .order('started_at', { ascending: false });

    if (error || !runs) return {};

    const taskMap: Record<string, string> = {};
    // Keep only the most recent run per agent
    for (const run of runs) {
      if (taskMap[run.agent_id]) continue; // already have a newer entry
      const agoMin = run.started_at
        ? Math.floor((Date.now() - new Date(run.started_at).getTime()) / 60000)
        : 999;

      if (run.status === 'running') {
        const label = (run.task_title || 'Working').slice(0, 48).replace(/\n/g, ' ');
        taskMap[run.agent_id] = `Working: ${label}`;
      } else if (agoMin < 30) {
        const label = (run.task_title || 'Task').slice(0, 40).replace(/\n/g, ' ');
        taskMap[run.agent_id] = `Completed: ${label} (${agoMin}m ago)`;
      } else {
        taskMap[run.agent_id] = agoMin < 120
          ? `Idle · last task ${agoMin}m ago`
          : `Idle · last task ${Math.floor(agoMin / 60)}h ago`;
      }
    }
    return taskMap;
  } catch {
    return {};
  }
}

export async function GET() {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const encoder = new TextEncoder();
  let lastStateStr = '';
  let alive = true;

  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        if (!alive) return;
        try {
          const state = await getAgentTaskMap();
          const stateStr = JSON.stringify(state);
          if (stateStr !== lastStateStr) {
            const payload = JSON.stringify({ type: 'state', agentCurrentTask: state, ts: Date.now() });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            lastStateStr = stateStr;
          }
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          alive = false;
          try { controller.close(); } catch { /* ignore */ }
        }
      };

      await send();

      // 30s interval (was 3s) — reduces egress significantly
      const interval = setInterval(async () => {
        if (!alive) { clearInterval(interval); return; }
        await send();
      }, 30000);

      // Reconnect after 10 min
      setTimeout(() => {
        alive = false;
        clearInterval(interval);
        try { controller.close(); } catch { /* ignore */ }
      }, 600000);
    },
    cancel() { alive = false; }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
