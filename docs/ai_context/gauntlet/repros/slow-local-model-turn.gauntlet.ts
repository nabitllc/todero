// Repro — wave 1, gauntlet item 0: a slow local model derailed the loop.
//
// The hire on the live loop wrote 180 s for the wait on a model running on
// this machine. The machine was busy, the model took two to three minutes per
// turn, and the http adapter cut the call off. One task was cut off three
// times in a row, and the recovery paths took over a healthy loop from there.
//
// This is that failure, scaled down so it runs in under a second: a real
// loopback chat endpoint that answers later than the wait written on the
// config. The fix is a floor on the wait for a model on this machine
// (server/src/adapters/http/local-model-timeout.ts), applied when the call is
// made, so the short number on the config can no longer cut the model off.
//
// Fails on origin/main (the call is cut off, `timedOut: true`), passes on
// fix/local-model-slow-turns. Run with:
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/slow-local-model-turn.gauntlet.ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute } from "../../../../server/src/adapters/http/execute.js";

/** How long the stand-in model thinks before it answers. */
const MODEL_THINKING_MS = 500;

/** What the hire wrote on the config — far too short for that model, as on the live loop. */
const WAIT_THE_HIRE_WROTE_MS = 50;

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done. Handing this back." } }] }));
    }, MODEL_THINKING_MS);
    req.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function turnAgainst(config: Record<string, unknown>) {
  return execute({
    runId: "repro-run",
    agent: {
      id: "repro-agent",
      companyId: "repro-company",
      name: "Agent",
      adapterType: "http" as const,
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config,
    context: {} as Record<string, unknown>,
    onLog: async () => {},
  });
}

describe("wave 1: a slow model on this machine", () => {
  it("is not cut off by the short wait the hire wrote", async () => {
    const result = await turnAgainst({
      url: `${baseUrl}/v1/chat/completions`,
      method: "POST",
      timeoutMs: WAIT_THE_HIRE_WROTE_MS,
      model: "qwen2.5-coder:14b",
      localLlm: {
        runtimeId: "ollama",
        runtimeLabel: "Ollama",
        baseUrl,
        modelId: "qwen2.5-coder:14b",
      },
    });

    expect(result.timedOut ?? false).toBe(false);
    expect(result.errorCode ?? null).toBeNull();
  });

  it("recognises the same endpoint without the block the wizard writes", async () => {
    const result = await turnAgainst({
      url: `${baseUrl}/v1/chat/completions`,
      method: "POST",
      timeoutMs: WAIT_THE_HIRE_WROTE_MS,
      model: "qwen2.5-coder:14b",
    });

    expect(result.timedOut ?? false).toBe(false);
  });

  it("still cuts off an ordinary webhook that keeps its own wait", async () => {
    // The floor is for a model answering a chat endpoint. Anything else keeps
    // the number it was given, short or not — otherwise every slow webhook
    // would hold a turn open for ten minutes.
    const result = await turnAgainst({
      url: `${baseUrl}/webhook`,
      method: "POST",
      timeoutMs: WAIT_THE_HIRE_WROTE_MS,
    });

    expect(result.timedOut).toBe(true);
  });
});
