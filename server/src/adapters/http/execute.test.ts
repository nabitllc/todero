import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_INTENT_AGENT_GUIDANCE } from "@todero/shared";
import {
  buildHeartbeatRunIssueComment,
  mergeHeartbeatRunResultJson,
  MAX_FALLBACK_COMMENT_CHARS,
  FALLBACK_COMMENT_CONTINUED_MARKER,
} from "../../services/heartbeat-run-summary.js";
import { execute } from "./execute.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const LOCAL_LLM_COMPLETION =
  "Let me outline the first-task plan. I'll start with marketplace checkout, then payments. First, ship the listing page.";

function localLlmExecuteArgs() {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Agent",
      adapterType: "http" as const,
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
      toderoTaskMarkdown:
        'Todero task context:\n- Title: "Ship the marketplace"\n\nCompany mission (from onboarding):\nShip the marketplace',
    },
    onLog: async () => {},
  };
}

function chatCompletionsResponse(content: string, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

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
      return chatCompletionsResponse(LOCAL_LLM_COMPLETION);
    });
    vi.stubGlobal("fetch", fetchMock);

    await execute(localLlmExecuteArgs());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/chat/completions");
  });

  it("writes a 2xx chat completion onto the ticket comment the heartbeat posts", async () => {
    const fetchMock = vi.fn(async () => chatCompletionsResponse(LOCAL_LLM_COMPLETION));
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(localLlmExecuteArgs());

    const persisted = mergeHeartbeatRunResultJson(result.resultJson ?? null, result.summary ?? null);
    expect(persisted?.summary).toBe(LOCAL_LLM_COMPLETION);
    const comment = buildHeartbeatRunIssueComment(persisted);
    expect(comment).toBe(LOCAL_LLM_COMPLETION);
    expect(comment).toContain("Let me outline");
    expect(comment).not.toMatch(/did not post a summary comment/i);
    expect(comment).not.toMatch(/transcript withheld/i);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("posts a long First,/I'll conversational completion truncated with continued, not a stub", async () => {
    const longPlan = (
      "First, I'll map the checkout flow. Let me keep going. " + "next step. ".repeat(200)
    ).trim();
    expect(longPlan.length).toBeGreaterThan(MAX_FALLBACK_COMMENT_CHARS);
    const fetchMock = vi.fn(async () => chatCompletionsResponse(longPlan));
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(localLlmExecuteArgs());
    const persisted = mergeHeartbeatRunResultJson(result.resultJson ?? null, result.summary ?? null);
    expect(persisted?.summary).toBe(longPlan);
    const comment = buildHeartbeatRunIssueComment(persisted);
    expect(comment).toContain("First, I'll map the checkout flow");
    expect(comment).toContain("Let me keep going");
    expect(comment).toContain(FALLBACK_COMMENT_CONTINUED_MARKER);
    expect(comment).toMatch(/continued/i);
    expect(comment).not.toMatch(/did not post a summary comment/i);
    expect(comment).not.toMatch(/transcript withheld/i);
    expect(comment).not.toBe(longPlan);
    expect(comment!.length).toBe(MAX_FALLBACK_COMMENT_CHARS);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not treat an empty 2xx chat completion as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(execute(localLlmExecuteArgs())).rejects.toThrow(
      /empty assistant text/i,
    );
  });

  it("does not treat a 2xx body with no assistant text as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(execute(localLlmExecuteArgs())).rejects.toThrow(
      /empty assistant text/i,
    );
  });
});
