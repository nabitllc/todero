export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function getAgentState(): Promise<Record<string, string>> {
  try {
    const { stdout } = await execAsync('/opt/homebrew/bin/openclaw status --json', { timeout: 5000 });
    const data = JSON.parse(stdout);
    const taskMap: Record<string, string> = {};
    
    if (data.agents) {
      for (const agent of data.agents) {
        if (agent.id && agent.status) {
          taskMap[agent.id] = agent.status;
        }
      }
    }
    
    // Fallback: parse from sessions
    if (Object.keys(taskMap).length === 0 && data.sessions) {
      for (const session of data.sessions) {
        if (session.agentId) {
          taskMap[session.agentId] = session.active ? `Active · ${session.tokenCount || 0} tokens` : 'Idle';
        }
      }
    }
    
    return taskMap;
  } catch (e) {
    return {};
  }
}

export async function GET() {
  const encoder = new TextEncoder();
  let lastState = '';
  let alive = true;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial state immediately
      try {
        const state = await getAgentState();
        const payload = JSON.stringify({ type: 'state', agentCurrentTask: state, ts: Date.now() });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        lastState = JSON.stringify(state);
      } catch (e) {}

      // Poll every 3 seconds, push only on change
      const interval = setInterval(async () => {
        if (!alive) { clearInterval(interval); return; }
        try {
          const state = await getAgentState();
          const stateStr = JSON.stringify(state);
          if (stateStr !== lastState) {
            const payload = JSON.stringify({ type: 'state', agentCurrentTask: state, ts: Date.now() });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            lastState = stateStr;
          }
          // Heartbeat every cycle to keep connection alive
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch (e) {
          // Connection might be closed
          alive = false;
          clearInterval(interval);
          try { controller.close(); } catch (e2) {}
        }
      }, 3000);

      // Cleanup after 5 minutes (client will reconnect)
      setTimeout(() => {
        alive = false;
        clearInterval(interval);
        try { controller.close(); } catch (e) {}
      }, 300000);
    },
    cancel() {
      alive = false;
    }
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
