export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';

const AGENT_IDS = ['main', 'scout', 'ops', 'kemuni-sme', 'vespera-sme'];

async function getAgentTaskMap(): Promise<Record<string, string>> {
  const taskMap: Record<string, string> = {};
  for (const agentId of AGENT_IDS) {
    const sessionsPath = `/Users/kemuniagent/.openclaw/agents/${agentId}/sessions/sessions.json`;
    if (!fs.existsSync(sessionsPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
      const entries = Object.entries(raw as Record<string, any>)
        .filter(([, v]) => v && typeof v === 'object')
        .sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      if (entries.length === 0) continue;

      const [key, val] = entries[0] as [string, any];
      const channel = key.split(':')[2] || 'session';
      const agoMin = Math.floor((Date.now() - (val.updatedAt ?? Date.now())) / 60000);

      // Real-time check: session file mtime within 30s = currently processing
      let fileMtimeSec = 9999;
      try {
        const sf = (val as any).sessionFile;
        if (sf && fs.existsSync(sf)) {
          fileMtimeSec = Math.floor((Date.now() - fs.statSync(sf).mtimeMs) / 1000);
        }
      } catch { /* non-fatal */ }

      const isActive = agoMin < 10 || fileMtimeSec < 30;
      const isLive = fileMtimeSec < 30;

      if (!isActive) {
        taskMap[agentId] = agoMin < 60
          ? `Last: ${channel} ${agoMin}m ago`
          : `Idle · last ${Math.floor(agoMin / 60)}h ago`;
        continue;
      }

      // Try to read last user message from JSONL
      let lastUserMsg = '';
      try {
        const sf = (val as any).sessionFile;
        if (sf) {
          const jsonlPath = sf.startsWith('/') ? sf
            : `/Users/kemuniagent/.openclaw/agents/${agentId}/sessions/${sf}`;
          if (fs.existsSync(jsonlPath)) {
            const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
              try {
                const obj = JSON.parse(lines[i]);
                const msg = obj.message ?? obj;
                if (msg.role === 'user') {
                  let text = typeof msg.content === 'string' ? msg.content
                    : Array.isArray(msg.content)
                      ? (msg.content.find((b: any) => b.type === 'text')?.text ?? '')
                      : '';
                  text = text
                    .replace(/^Sender \(untrusted[^)]+\)[^]*?\n\n/m, '')
                    .replace(/^\[.*?\]\s*/m, '')
                    .trim();
                  if (text && text.length > 3 && !text.startsWith('[') && !text.startsWith('Read HEARTBEAT')) {
                    lastUserMsg = text.slice(0, 48).replace(/\n/g, ' ');
                    break;
                  }
                }
              } catch { continue; }
            }
          }
        }
      } catch { /* non-fatal */ }

      const channelLabel = channel === 'telegram' ? 'Telegram'
        : channel === 'discord' ? 'Discord'
        : channel === 'cron' ? 'Cron'
        : channel === 'subagent' ? 'Sub-agent'
        : 'Session';

      taskMap[agentId] = lastUserMsg
        ? `${isLive ? 'Processing' : 'Active'}: ${lastUserMsg}`
        : `${isLive ? 'Processing' : 'Active'} on ${channelLabel}`;
    } catch { /* skip agent */ }
  }
  return taskMap;
}

export async function GET() {
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
          // Always send on first tick; then only on change
          if (stateStr !== lastStateStr) {
            const payload = JSON.stringify({ type: 'state', agentCurrentTask: state, ts: Date.now() });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            lastStateStr = stateStr;
          }
          // Keep-alive comment every cycle
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          alive = false;
          try { controller.close(); } catch { /* ignore */ }
        }
      };

      // Immediate first read
      await send();

      // Then every 3 seconds
      const interval = setInterval(async () => {
        if (!alive) { clearInterval(interval); return; }
        await send();
      }, 3000);

      // Reconnect after 5 min
      setTimeout(() => {
        alive = false;
        clearInterval(interval);
        try { controller.close(); } catch { /* ignore */ }
      }, 300000);
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
