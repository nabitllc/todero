import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, asNumber, parseObject } from "../utils.js";
import {
  buildChatCompletionsBody,
  isChatCompletionsUrl,
  parseChatCompletionsReply,
  parseChatCompletionsText,
} from "./chat-completions.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, runId, agent, context } = ctx;
  const url = asString(config.url, "");
  if (!url) throw new Error("HTTP adapter missing url");

  const method = asString(config.method, "POST");
  const timeoutMs = asNumber(config.timeoutMs, 0);
  const headers = parseObject(config.headers) as Record<string, string>;
  const payloadTemplate = parseObject(config.payloadTemplate);
  const chatCompletions = isChatCompletionsUrl(url);
  const body = chatCompletions
    ? buildChatCompletionsBody({ config, context, payloadTemplate, agentName: agent.name })
    : {
        ...payloadTemplate,
        agentId: agent.id,
        runId,
        context,
        ...(ctx.runtimeTools ? { toderoRuntimeTools: ctx.runtimeTools } : {}),
      };

  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    // HTTP adapters have no child-process spawn event. Signal immediately
    // before starting the remote request so dispatch gates can release without
    // waiting for the endpoint to respond.
    ctx.onDispatch?.();
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      ...(timer ? { signal: controller.signal } : {}),
    });

    if (!res.ok) {
      throw new Error(`HTTP invoke failed with status ${res.status}`);
    }

    if (!chatCompletions) {
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        summary: `HTTP ${method} ${url}`,
      };
    }

    // Heartbeat posts resultJson.summary as the ticket comment (issueComments.body)
    // via buildHeartbeatRunIssueComment. Discarding a 2xx body used to count as
    // success with nothing on the ticket.
    const raw = await res.text();
    const completion = parseChatCompletionsText(raw);
    if (!completion) {
      throw new Error("HTTP chat completions returned empty assistant text");
    }
    await ctx.onLog("stdout", completion.endsWith("\n") ? completion : `${completion}\n`);
    // The trailing status line is for Todero, not the user: it tells the
    // heartbeat whether to close the task or hand the turn back.
    const reply = parseChatCompletionsReply(completion);
    const summary = reply.body || completion;
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary,
      resultJson: { summary, toderoDisposition: reply.disposition },
    };
  } catch (err) {
    if (timer && err instanceof Error && err.name === "AbortError") {
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        errorMessage: `HTTP ${method} ${url} timed out after ${timeoutMs}ms`,
        errorCode: "timeout",
      };
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
