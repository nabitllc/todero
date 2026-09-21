import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_INTENT_AGENT_GUIDANCE } from "@todero/shared";
import { TODERO_PLAN_JSON_SCHEMA, TODERO_PLAN_JSON_SCHEMA_NAME } from "@todero/shared/todero-plan-schema";
import {
  buildMissingPlanRetryInstruction,
} from "../../todero/missing-plan-recovery.js";
import {
  buildHeartbeatRunIssueComment,
  mergeHeartbeatRunResultJson,
  MAX_FALLBACK_COMMENT_CHARS,
  FALLBACK_COMMENT_CONTINUED_MARKER,
} from "../../services/heartbeat-run-summary.js";
import { execute } from "./execute.js";
import { STRUCTURED_PLAN_UNREADABLE_NOTE } from "./structured-plan.js";

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
    } as Record<string, unknown>,
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

  it("records the model that actually answered in resultJson.toderoModel", async () => {
    const fetchMock = vi.fn(async () => chatCompletionsResponse(LOCAL_LLM_COMPLETION));
    vi.stubGlobal("fetch", fetchMock);

    const args = localLlmExecuteArgs();
    const result = await execute(args);

    expect((result.resultJson as Record<string, unknown> | undefined)?.toderoModel).toBe(
      "local-model",
    );
  });

  it("records the routed model, not the configured default, when a task kind picks a different one", async () => {
    const fetchMock = vi.fn(async () => chatCompletionsResponse(LOCAL_LLM_COMPLETION));
    vi.stubGlobal("fetch", fetchMock);

    const args = localLlmExecuteArgs();
    args.context = {
      ...args.context,
      toderoTaskKind: "planning",
      toderoAvailableModels: ["qwen2.5-coder:14b"],
    };
    const result = await execute(args);

    expect((result.resultJson as Record<string, unknown> | undefined)?.toderoModel).toBe(
      "qwen2.5-coder:14b",
    );
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
      "First, I'll map the checkout flow. Let me keep going. " + "next step. ".repeat(1500)
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

describe("http adapter chat completions: plan block and empty replies", () => {
  it("lifts a plan block out of the reply and keeps the words around it as the comment", async () => {
    const reply = [
      "Here is my proposal.",
      "",
      "```todero-plan",
      "goal: Seat neighbors at dinners",
      "tasks:",
      "  - title: Draft the sign-up spec",
      "```",
      "",
      "STATUS: waiting",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(reply)));
    const result = await execute(localLlmExecuteArgs());
    expect(result.summary).toBe("Here is my proposal.");
    expect(result.resultJson).toMatchObject({ toderoDisposition: "waiting" });
    expect(String((result.resultJson as Record<string, unknown>).toderoPlanBlock)).toContain("goal: Seat neighbors at dinners");
    expect(String((result.resultJson as Record<string, unknown>).toderoPlanBlock)).toContain("- title: Draft the sign-up spec");
  });

  it("asks once more when the model answers with only a status line", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatCompletionsResponse("STATUS: waiting"))
      .mockResolvedValueOnce(chatCompletionsResponse("Here is the registration form spec.\nSTATUS: done"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await execute(localLlmExecuteArgs());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondBody.messages.at(-2)).toEqual({ role: "assistant", content: "STATUS: waiting" });
    expect(secondBody.messages.at(-1)?.role).toBe("user");
    expect(secondBody.messages.at(-1)?.content).toContain("only a status line");
    expect(result.summary).toBe("Here is the registration form spec.");
    expect(result.resultJson).toMatchObject({ toderoDisposition: "done" });
  });
});

describe("the window the request itself asks Ollama for", () => {
  it("asks Ollama's own endpoint for the recorded window — the OpenAI-shaped one ignores it", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: "Here is the plan.\nSTATUS: waiting" }, done_reason: "stop" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const args = localLlmExecuteArgs();
    args.config.url = "http://127.0.0.1:11434/v1/chat/completions";
    args.context = { ...args.context, toderoContextLength: 16_384 };
    const result = await execute(args);

    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0]!.body.options).toMatchObject({ num_ctx: 16_384 });
    expect(calls[0]!.body.stream).toBe(false);
    expect(Array.isArray(calls[0]!.body.messages)).toBe(true);
    expect(result.summary).toBe("Here is the plan.");
    expect(result.resultJson).toMatchObject({ toderoDisposition: "waiting" });
  });

  it("keeps the OpenAI-shaped request when no window was ever recorded", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(String(url));
      return chatCompletionsResponse(LOCAL_LLM_COMPLETION);
    });
    vi.stubGlobal("fetch", fetchMock);

    const args = localLlmExecuteArgs();
    args.config.url = "http://127.0.0.1:11434/v1/chat/completions";
    await execute(args);

    expect(calls).toEqual(["http://127.0.0.1:11434/v1/chat/completions"]);
  });
});

describe("asking the runtime for the plan in a shape it cannot get wrong", () => {
  function planRetryArgs() {
    const args = localLlmExecuteArgs();
    args.config.url = "http://127.0.0.1:11434/v1/chat/completions";
    args.context = { ...args.context, toderoTurnInstruction: buildMissingPlanRetryInstruction() };
    return args;
  }

  const PLAN_JSON = JSON.stringify({
    message: "Here is the plan.",
    goal: "Seat neighbors at monthly dinners",
    features: [{ name: "Sign-ups", why: "People need a way in", done_when: "A form is live" }],
    tasks: [{ title: "Draft the sign-up spec", feature: "Sign-ups", output: "A one-page spec", after: "" }],
  });

  it("puts the schema on the OpenAI-shaped request and reads the plan back out", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return chatCompletionsResponse(PLAN_JSON);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(planRetryArgs());

    expect(calls[0]!.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: TODERO_PLAN_JSON_SCHEMA_NAME, schema: TODERO_PLAN_JSON_SCHEMA },
    });
    expect(result.summary).toBe("Here is the plan.");
    const resultJson = result.resultJson as Record<string, unknown>;
    expect(resultJson.toderoDisposition).toBe("waiting");
    expect(resultJson.toderoStructuredPlan).toBe("held");
    expect(String(resultJson.toderoPlanBlock)).toContain("goal: Seat neighbors at monthly dinners");
    expect(String(resultJson.toderoPlanBlock)).toContain("- title: Draft the sign-up spec");
  });

  it("asks Ollama's own endpoint with `format` when a window is recorded", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ message: { role: "assistant", content: PLAN_JSON } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const args = planRetryArgs();
    args.context = { ...args.context, toderoContextLength: 16_384 };
    const result = await execute(args);

    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0]!.body.format).toEqual(TODERO_PLAN_JSON_SCHEMA);
    expect(calls[0]!.body.response_format).toBeUndefined();
    expect((result.resultJson as Record<string, unknown>).toderoStructuredPlan).toBe("held");
  });

  it("still takes a fenced plan when the runtime ignored the schema", async () => {
    const reply = [
      "Here is my proposal.",
      "",
      "```todero-plan",
      "goal: Seat neighbors at dinners",
      "tasks:",
      "  - title: Draft the sign-up spec",
      "```",
      "",
      "STATUS: waiting",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(reply)));

    const result = await execute(planRetryArgs());

    expect(result.summary).toBe("Here is my proposal.");
    const resultJson = result.resultJson as Record<string, unknown>;
    expect(resultJson.toderoStructuredPlan).toBe("prose");
    expect(String(resultJson.toderoPlanBlock)).toContain("goal: Seat neighbors at dinners");
  });

  it("asks for nothing on an ordinary turn, so a working conversation is untouched", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return chatCompletionsResponse(LOCAL_LLM_COMPLETION);
    });
    vi.stubGlobal("fetch", fetchMock);

    const args = localLlmExecuteArgs();
    args.config.url = "http://127.0.0.1:11434/v1/chat/completions";
    const result = await execute(args);

    expect(calls[0]!.response_format).toBeUndefined();
    expect(result.resultJson).not.toHaveProperty("toderoStructuredPlan");
  });

  it("asks for nothing when the endpoint is not one Todero knows can enforce it", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return chatCompletionsResponse("Here is the plan.\nSTATUS: waiting");
    });
    vi.stubGlobal("fetch", fetchMock);

    const args = planRetryArgs();
    args.config.url = "https://api.example.com/v1/chat/completions";
    args.config.localLlm = { runtimeId: "vllm", modelId: "local-model" };
    const result = await execute(args);

    expect(calls[0]!.response_format).toBeUndefined();
    expect(result.resultJson).not.toHaveProperty("toderoStructuredPlan");
  });
});

describe("what the person is shown when the shaped reply is not a plan", () => {
  function planRetryArgs() {
    const args = localLlmExecuteArgs();
    args.config.url = "http://127.0.0.1:11434/v1/chat/completions";
    args.context = { ...args.context, toderoTurnInstruction: buildMissingPlanRetryInstruction() };
    return args;
  }

  it("posts the object's own words, not the JSON, when the shape came back empty", async () => {
    const emptyPlan = JSON.stringify({
      message: "Here is what I have so far.",
      goal: "Seat neighbors at monthly dinners",
      features: [],
      tasks: [],
    });
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(emptyPlan)));

    const result = await execute(planRetryArgs());

    expect(result.summary).toBe("Here is what I have so far.");
    expect(result.summary).not.toContain("{");
    expect(result.summary).not.toContain("\"goal\"");
    const resultJson = result.resultJson as Record<string, unknown>;
    expect(resultJson.toderoStructuredPlan).toBe("unreadable");
    expect(resultJson).not.toHaveProperty("toderoPlanBlock");
  });

  it("hands the turn back rather than closing the task on a status line beside the blob", async () => {
    const reply = [JSON.stringify({ message: "All set.", features: [], tasks: [] }), "", "STATUS: done"].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(reply)));

    const result = await execute(planRetryArgs());

    expect(result.summary).toBe("All set.");
    const resultJson = result.resultJson as Record<string, unknown>;
    // No plan came back, so the turn goes to the person. A `STATUS: done` the
    // model wrote around an unusable object must not close the task.
    expect(resultJson.toderoDisposition).toBe("waiting");
    expect(resultJson.toderoStructuredPlan).toBe("unreadable");
  });

  it("keeps the sentence in front of the blob and still posts no JSON", async () => {
    const reply = [
      "Sure, here is the plan:",
      JSON.stringify({ message: "Tell me which features matter most.", features: [], tasks: [] }),
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(reply)));

    const result = await execute(planRetryArgs());

    expect(result.summary).toContain("Sure, here is the plan:");
    expect(result.summary).toContain("Tell me which features matter most.");
    expect(result.summary).not.toContain("{");
    expect((result.resultJson as Record<string, unknown>).toderoStructuredPlan).toBe("unreadable");
  });

  it("recovers the plan out of the reply the Zz Recover organization actually got", async () => {
    // Run 6752efd3, copied out of the dev database: the words are under
    // `body` and the plan one level down under `plan`. The person was shown
    // this blob verbatim.
    const reply =
      '{"body": "Here is the plan.", "plan": {"goal": "A weekly dinner table of five strangers in Tampa.",' +
      ' "features": [{"name": "One-page concept", "why": "Everyone needs the same picture of the idea",' +
      ' "done_when": "A one-page document exists and reads well"}]}}';
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(reply)));

    const result = await execute(planRetryArgs());

    expect(result.summary).toBe("Here is the plan.");
    expect(result.summary).not.toContain("{");
    const resultJson = result.resultJson as Record<string, unknown>;
    expect(resultJson.toderoStructuredPlan).toBe("held");
    expect(String(resultJson.toderoPlanBlock)).toContain(
      "goal: A weekly dinner table of five strangers in Tampa.",
    );
    expect(String(resultJson.toderoPlanBlock)).toContain("One-page concept");
  });

  it("posts the words it got to before the runtime ran out of room, not the half object", async () => {
    const truncated =
      '{"message": "Here is the plan so far.", "goal": "Seat neighbors at monthly dinners", "features": [{"name": "Sign';
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(truncated)));

    const result = await execute(planRetryArgs());

    expect(result.summary).toBe("Here is the plan so far.");
    expect(result.summary).not.toContain("{");
    expect((result.resultJson as Record<string, unknown>).toderoStructuredPlan).toBe("unreadable");
  });

  it("posts a plain sentence when the object has no words for the person either", async () => {
    const noMessage = JSON.stringify({ message: "", goal: "", features: [], tasks: [] });
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(noMessage)));

    const result = await execute(planRetryArgs());

    expect(result.summary).toBe(STRUCTURED_PLAN_UNREADABLE_NOTE);
    expect(result.summary).not.toContain("{");
    expect((result.resultJson as Record<string, unknown>).toderoStructuredPlan).toBe("unreadable");
  });

  it("leaves a prose reply alone — it is not an attempt at the object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chatCompletionsResponse(LOCAL_LLM_COMPLETION)));

    const result = await execute(planRetryArgs());

    expect(result.summary).toBe(LOCAL_LLM_COMPLETION);
    expect((result.resultJson as Record<string, unknown>).toderoStructuredPlan).toBe("prose");
  });
});
