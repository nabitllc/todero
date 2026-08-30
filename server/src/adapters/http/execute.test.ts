import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_INTENT_AGENT_GUIDANCE } from "@todero/shared";
import { execute } from "./execute.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("http adapter execute", () => {
  it("delivers the complete runtime connection descriptor and shared guidance", async () => {
    const onDispatch = vi.fn();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(onDispatch).toHaveBeenCalledOnce();
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.toderoRuntimeTools).toEqual({
        version: 1,
        guidance: CONNECTION_INTENT_AGENT_GUIDANCE,
        mcpEndpoint: "https://todero.test/mcp/runtime-tools",
        rest: {
          connectionsSearch: "https://todero.test/runtime-tools/connections/search",
          connectionRequest: "https://todero.test/runtime-tools/connections/request",
        },
        bearerToken: "run-token",
        expiresAt: "2026-08-26T15:00:00.000Z",
        tools: ["connections_search", "connection_request"],
      });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Agent",
        adapterType: "http",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: { url: "https://example.test/webhook" },
      context: {},
      runtimeTools: {
        version: 1,
        guidance: CONNECTION_INTENT_AGENT_GUIDANCE,
        mcpEndpoint: "https://todero.test/mcp/runtime-tools",
        rest: {
          connectionsSearch: "https://todero.test/runtime-tools/connections/search",
          connectionRequest: "https://todero.test/runtime-tools/connections/request",
        },
        bearerToken: "run-token",
        expiresAt: "2026-08-26T15:00:00.000Z",
        tools: ["connections_search", "connection_request"],
      },
      onLog: async () => {},
      onDispatch,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onDispatch).toHaveBeenCalledOnce();
  });

  it("reports configured request timeout as timed_out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })),
    );

    const result = await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Agent",
        adapterType: "http",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        url: "https://example.test/webhook",
        timeoutMs: 1,
      },
      context: {},
      onLog: async () => {},
    });

    expect(result.timedOut).toBe(true);
    expect(result.errorCode).toBe("timeout");
    expect(result.errorMessage).toContain("timed out after 1ms");
  });

  it("POSTs the typed mission in the /v1/chat/completions prompt, not a raw context dump", async () => {
    const mission = "Ship the marketplace";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model?: string;
        messages?: Array<{ role?: string; content?: string }>;
        context?: unknown;
      };
      const prompt = (body.messages ?? []).map((message) => message.content ?? "").join("\n");
      expect(body.model).toBe("local-model");
      expect(prompt).toContain(mission);
      expect(prompt).toContain("Company mission (from onboarding):");
      // A raw { context } dump is what the http adapter used to send. The
      // chat-completions endpoint never reads that field.
      expect(body.context).toBeUndefined();
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Agent",
        adapterType: "http",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        url: "http://127.0.0.1:8080/v1/chat/completions",
        model: "local-model",
        localLlm: { runtimeId: "ollama", modelId: "local-model" },
      },
      context: {
        toderoTaskMarkdown: `Todero task context:\n- Title: "${mission}"\n\nCompany mission (from onboarding):\n${mission}`,
      },
      onLog: async () => {},
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/chat/completions");
  });
});
