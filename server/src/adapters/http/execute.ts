import { formatToderoPlanBlock, parseToderoPlanBlock } from "@todero/shared";
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, asNumber, parseObject } from "../utils.js";
import {
  buildChatCompletionsBody,
  CHAT_COMPLETIONS_EMPTY_REPLY_NUDGE,
  CHAT_COMPLETIONS_NO_TEXT_FALLBACK,
  isChatCompletionsUrl,
  parseChatCompletionsReply,
  parseChatCompletionsText,
  parseChatCompletionsFinishReason,
  chatCompletionsReplyWasCutOff,
  CHAT_COMPLETIONS_CUT_OFF_NOTE,
  type ChatCompletionsMessage,
} from "./chat-completions.js";
import { resolveHttpAdapterTimeoutMs } from "./local-model-timeout.js";

/**
 * Detects if a reply claims to present a plan but has no actual plan block.
 * Looks for language like "approve this plan", "do you confirm", etc.
 */
function claimsPlanWithoutStructure(replyBody: string): boolean {
  if (!replyBody.trim()) return false;
  // Plan-claiming language patterns
  const patterns = [
    /\bapprove\b/i,           // "Do you approve this plan?"
    /\bconfirm\b/i,           // "Do you confirm..."
    /\baccept\b/i,            // "Do you accept..."
    /here['\s]s.*plan/i,      // "Here's the plan" but didn't provide it
    /the plan/i,              // Reference to a plan
    /ready.*(?:approve|review)/i, // "I'm ready. Do you approve?"
  ];
  return patterns.some(pattern => pattern.test(replyBody));
}

/**
 * One-shot retry instruction for when the model claims a plan but didn't produce the block.
 * Teaches the exact shape required, once.
 */
export const CHAT_COMPLETIONS_NO_PLAN_BLOCK_NUDGE = `I saw you mention a plan, but I didn't receive it in the required format. The plan must be inside a fenced block with this exact shape:

\`\`\`todero-plan
goal: One sentence: what we are building and for whom.
features:
  - name: Feature name
    why: Why it matters
    done_when: How we know it's finished
tasks:
  - title: Task title
    feature: Which feature
    output: What you'll deliver
\`\`\`

Three to seven features. Four to twelve tasks. Write the plan block now.`;

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, runId, agent, context } = ctx;
  const url = asString(config.url, "");
  if (!url) throw new Error("HTTP adapter missing url");

  const method = asString(config.method, "POST");
  const timeoutMs = resolveHttpAdapterTimeoutMs(config as Record<string, unknown>);
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
    let completion = parseChatCompletionsText(raw);
    let finishReason = parseChatCompletionsFinishReason(raw);
    if (!completion) {
      throw new Error("HTTP chat completions returned empty assistant text");
    }
    await ctx.onLog("stdout", completion.endsWith("\n") ? completion : `${completion}\n`);
    // The trailing status line is for Todero, not the user: it tells the
    // heartbeat whether to close the task or hand the turn back.
    let reply = parseChatCompletionsReply(completion);
    // A local model sometimes answers a fresh task with nothing but the status
    // line. One nudge in the same run gets the actual reply far more often
    // than a new wake would, and costs one extra request.
    if (!reply.body && Array.isArray(body.messages) && !controller.signal.aborted) {
      const retryBody = {
        ...body,
        messages: [
          ...(body.messages as ChatCompletionsMessage[]),
          { role: "assistant", content: completion },
          { role: "user", content: CHAT_COMPLETIONS_EMPTY_REPLY_NUDGE },
        ],
      };
      const retry = await fetch(url, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(retryBody),
        ...(timer ? { signal: controller.signal } : {}),
      });
      if (retry.ok) {
        const retriedRaw = await retry.text();
        const retried = parseChatCompletionsText(retriedRaw);
        if (retried) {
          await ctx.onLog("stdout", `[todero] Empty reply; asked once more.\n${retried}\n`);
          completion = retried;
          reply = parseChatCompletionsReply(retried);
          finishReason = parseChatCompletionsFinishReason(retriedRaw);
        }
      }
    }
    // A reply that claims a plan but has no actual plan block structure.
    // This happens when small models understand they should propose a plan
    // but fail to emit the fenced block. Retry once with exact shape instructions.
    // Do not loop forever: if the retry also fails, stop and post an error.
    const alreadyRetriedForNoPlanBlock = Array.isArray(body.messages)
      ? (body.messages as ChatCompletionsMessage[]).some(msg =>
          typeof msg.content === "string" && msg.content.includes("fenced block")
        )
      : false;
    if (
      reply.body &&
      claimsPlanWithoutStructure(reply.body) &&
      !parseToderoPlanBlock(reply.body) &&
      !alreadyRetriedForNoPlanBlock &&
      !controller.signal.aborted
    ) {
      const noPlanRetryBody = {
        ...body,
        messages: [
          ...(body.messages as ChatCompletionsMessage[]),
          { role: "assistant", content: completion },
          { role: "user", content: CHAT_COMPLETIONS_NO_PLAN_BLOCK_NUDGE },
        ],
      };
      const noPlanRetry = await fetch(url, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(noPlanRetryBody),
        ...(timer ? { signal: controller.signal } : {}),
      });
      if (noPlanRetry.ok) {
        const retriedRaw = await noPlanRetry.text();
        const retried = parseChatCompletionsText(retriedRaw);
        if (retried) {
          const retriedReply = parseChatCompletionsReply(retried);
          // Check if the retry produced a plan block
          if (parseToderoPlanBlock(retriedReply.body)) {
            // Success: the retry produced a block
            await ctx.onLog("stdout", `[todero] Retried: model produced the plan block.\n${retried}\n`);
            completion = retried;
            reply = retriedReply;
            finishReason = parseChatCompletionsFinishReason(retriedRaw);
          } else {
            // The retry also failed to produce a block. Stop here and post a clear error.
            await ctx.onLog(
              "stderr",
              "[todero] The model claimed to have a plan but could not produce it in the required format after a retry. Stopping.\n",
            );
            completion = `The agent said it had a plan but could not produce it in the required form. Please ask the agent to provide the plan in plain words so you can help guide it.`;
            reply = { body: completion, disposition: "waiting" };
          }
        }
      }
    }
    // A reply the model could not finish has no status line and no end. Say
    // so under it and hand the turn to the person, instead of reading the
    // half as a question the person has to guess at.
    const cutOff = chatCompletionsReplyWasCutOff(finishReason);
    if (cutOff) {
      reply = { body: `${reply.body}\n\n${CHAT_COMPLETIONS_CUT_OFF_NOTE}`.trim(), disposition: "waiting" };
      await ctx.onLog("stderr", "[todero] The model ran out of room before it finished; the task waits for the person.\n");
    }
    // A plan block is for Todero too: it becomes the task's Plan document and
    // the approval card, and the person reads the words around it.
    const planned = parseToderoPlanBlock(reply.body);
    // Never post the bare status line as if it were the reply.
    const summary = (planned ? planned.body : reply.body) || CHAT_COMPLETIONS_NO_TEXT_FALLBACK;
    // The routing choice (server/src/todero/model-routing.ts) already landed
    // on `body.model`; record it so the run log shows which model actually
    // answered, not just the agent's configured default.
    const chosenModel = asString((body as Record<string, unknown>).model, "");
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary,
      resultJson: {
        summary,
        toderoDisposition: reply.disposition,
        ...(chosenModel ? { toderoModel: chosenModel } : {}),
        ...(cutOff ? { toderoCutOff: true } : {}),
        ...(planned ? { toderoPlanBlock: formatToderoPlanBlock(planned.plan) } : {}),
      },
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
