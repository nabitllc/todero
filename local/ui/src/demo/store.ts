/*
  Demo store: recorded product responses plus the mutations the demo allows.
  Persisted to sessionStorage so a visitor's edits survive a reload in this tab.
  Nothing here talks to a server.
*/
import seedJson from "./seed.json";

export type ResponseKey = `${"GET" | "POST" | "PUT" | "PATCH" | "DELETE"} ${string}`;

export interface DemoSeed {
  version: number;
  /** When the seed was recorded; every timestamp is shifted so this reads as "now". */
  recordedAt: string;
  companyId: string;
  companyPrefix: string;
  userId: string;
  /** Recorded responses keyed by "METHOD /path" with real recorded ids in the path. */
  responses: Record<string, unknown>;
}

const STORAGE_KEY = "todero-demo";
const seed = seedJson as DemoSeed;

function load(): DemoSeed {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoSeed;
      if (parsed.version === seed.version) return parsed;
    }
  } catch {
    // Private mode or storage disabled: run in memory.
  }
  return fresh();
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Shift every ISO timestamp forward by (now - recordedAt) so "6m ago" stays "6m ago". */
function rebase<T>(value: T, offsetMs: number): T {
  if (typeof value === "string") {
    if (ISO.test(value)) return new Date(new Date(value).getTime() + offsetMs).toISOString() as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => rebase(v, offsetMs)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rebase(v, offsetMs);
    return out as T;
  }
  return value;
}

function fresh(): DemoSeed {
  const offset = Date.now() - new Date(seed.recordedAt).getTime();
  const shifted = rebase(seed, offset);
  shifted.recordedAt = new Date().toISOString();
  return shifted;
}

let state: DemoSeed = load();

function persist() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // In-memory only.
  }
}

export const store = {
  get seed() {
    return state;
  },
  get companyId() {
    return state.companyId;
  },
  get companyPrefix() {
    return state.companyPrefix;
  },
  get userId() {
    return state.userId;
  },
  read<T>(key: string): T | undefined {
    return state.responses[key] as T | undefined;
  },
  has(key: string): boolean {
    return key in state.responses;
  },
  write(key: string, value: unknown) {
    state.responses[key] = value;
    persist();
  },
  /** Write to every recorded variant of a path (with or without query string). */
  writeMatching(bareKey: string, value: unknown) {
    for (const k of Object.keys(state.responses)) {
      if (k === bareKey || k.startsWith(bareKey + "?")) state.responses[k] = value;
    }
    state.responses[bareKey] = value;
    persist();
  },
  update<T>(key: string, fn: (current: T) => T) {
    const current = state.responses[key] as T;
    state.responses[key] = fn(current);
    persist();
  },
  reset() {
    state = fresh();
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },
};

let counter = 0;
export function demoId(prefix: string): string {
  counter += 1;
  return `demo-${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function now(): string {
  return new Date().toISOString();
}
