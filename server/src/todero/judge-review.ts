/**
 * Running the reviewer: one extra chat completion against the same local
 * model, with the feature's "done when" line, what the task asked to be
 * handed in, and the work itself. Everything the reviewer decides is turned
 * into a `JudgeOutcome` here; the heartbeat applies it.
 *
 * The request goes to the reviewer agent's own adapter config, which is a
 * copy of the worker's, so there is nothing extra to configure.
 */
import type { Db } from "@todero/db";
import { parseToderoPlanBlock, type ToderoPlan } from "@todero/shared";
import { isChatCompletionsUrl, parseChatCompletionsText } from "../adapters/http/chat-completions.js";
import { documentService } from "../services/documents.js";
import { CONVERSATION_PLAN_DOCUMENT_KEY } from "./conversation-thread.js";
import { findJudgeAgentForLead, type JudgeAgentRow } from "./judge-agent.js";
import {
  buildJudgeComment,
  buildJudgeReviewPrompt,
  buildJudgeSystemPrompt,
  findPlanFeatureForTask,
  findPlanTaskByTitle,
  parseJudgeVerdict,
  planJudgeOutcome,
  readJudgeFailRounds,
  type JudgeOutcome,
  type JudgeVerdict,
} from "./judge.js";

/** A cold second model load can be slow; the worker's own timeout is the same order. */
export const JUDGE_REVIEW_TIMEOUT_MS = 120_000;
/** Enough for a verdict line and a paragraph, and no more. */
export const JUDGE_REVIEW_MAX_TOKENS = 400;

export type JudgeModelConfig = {
  url: string;
  model: string;
  headers: Record<string, string>;
  timeoutMs: number;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The reviewer can only run against an OpenAI-style chat endpoint. */
export function readJudgeModelConfig(adapterConfig: unknown): JudgeModelConfig | null {
  const config = readRecord(adapterConfig);
  const url = readString(config.url);
  if (!url || !isChatCompletionsUrl(url)) return null;
  const payloadTemplate = readRecord(config.payloadTemplate);
  const model = readString(config.model) || readString(payloadTemplate.model);
  const rawHeaders = readRecord(config.headers);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (typeof value === "string") headers[key] = value;
  }
  const timeoutMs = typeof config.timeoutMs === "number" && config.timeoutMs > 0
    ? config.timeoutMs
    : JUDGE_REVIEW_TIMEOUT_MS;
  return { url, model, headers, timeoutMs };
}

/**
 * One request, one verdict. Any failure (endpoint down, empty reply, no
 * verdict line) returns null, and the caller leaves the task exactly as the
 * worker's own reply asked: a reviewer that cannot answer never blocks work.
 */
export async function requestJudgeVerdict(input: {
  config: JudgeModelConfig;
  systemPrompt: string;
  prompt: string;
  fetcher?: typeof fetch;
}): Promise<{ verdict: JudgeVerdict; note: string } | null> {
  const fetcher = input.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const res = await fetcher(input.config.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...input.config.headers },
      body: JSON.stringify({
        ...(input.config.model ? { model: input.config.model } : {}),
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.prompt },
        ],
        max_tokens: JUDGE_REVIEW_MAX_TOKENS,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = parseChatCompletionsText(await res.text());
    if (!text) return null;
    return parseJudgeVerdict(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The approved plan this task came from, read back from the parent's Plan document. */
export async function loadApprovedPlanForParent(db: Db, parentIssueId: string): Promise<ToderoPlan | null> {
  const document = await documentService(db)
    .getIssueDocumentByKey(parentIssueId, CONVERSATION_PLAN_DOCUMENT_KEY)
    .catch(() => null);
  const parsed = parseToderoPlanBlock(document?.body ?? "");
  return parsed?.plan ?? null;
}

export type JudgeReviewResult = {
  outcome: JudgeOutcome;
  verdict: JudgeVerdict | null;
  note: string;
  comment: string | null;
  judgeAgent: JudgeAgentRow | null;
  /** Why no review happened, for the run log. */
  skipped: "not_a_plan_task" | "no_reviewer" | "no_model" | "no_deliverable" | "no_verdict" | null;
};

const SKIPPED: Omit<JudgeReviewResult, "skipped"> = {
  outcome: { kind: "skip" },
  verdict: null,
  note: "",
  comment: null,
  judgeAgent: null,
};

/**
 * Review one handed-in child task. Returns what should happen to it; the
 * caller writes the comment and the status.
 */
export async function reviewConversationHandIn(
  db: Db,
  input: {
    issue: { id: string; companyId: string; title: string; description: string | null; parentId: string | null };
    deliverable: string;
    leadAgentId: string;
    companyName?: string | null;
    autoAcceptWhenJudgePasses: boolean;
    fetcher?: typeof fetch;
  },
): Promise<JudgeReviewResult> {
  if (!input.issue.parentId) return { ...SKIPPED, skipped: "not_a_plan_task" };
  const deliverable = input.deliverable.trim();
  if (!deliverable) return { ...SKIPPED, skipped: "no_deliverable" };

  const judgeAgent = await findJudgeAgentForLead(db, {
    companyId: input.issue.companyId,
    leadAgentId: input.leadAgentId,
  });
  if (!judgeAgent) return { ...SKIPPED, skipped: "no_reviewer" };

  const config = readJudgeModelConfig(judgeAgent.adapterConfig);
  if (!config) return { ...SKIPPED, judgeAgent, skipped: "no_model" };

  const plan = await loadApprovedPlanForParent(db, input.issue.parentId);
  const planTask = findPlanTaskByTitle(plan, input.issue.title);
  const feature = findPlanFeatureForTask(plan, planTask);

  const review = await requestJudgeVerdict({
    config,
    systemPrompt: buildJudgeSystemPrompt({ judgeName: judgeAgent.name, companyName: input.companyName ?? null }),
    prompt: buildJudgeReviewPrompt({
      goal: plan?.goal ?? null,
      featureName: feature?.name ?? planTask?.feature ?? null,
      doneWhen: feature?.doneWhen ?? null,
      taskTitle: input.issue.title,
      expectedOutput: planTask?.output ?? null,
      deliverable,
    }),
    fetcher: input.fetcher,
  });
  if (!review) return { ...SKIPPED, judgeAgent, skipped: "no_verdict" };

  const outcome = planJudgeOutcome({
    verdict: review.verdict,
    failRounds: readJudgeFailRounds(input.issue.description),
    autoAcceptWhenJudgePasses: input.autoAcceptWhenJudgePasses,
  });
  return {
    outcome,
    verdict: review.verdict,
    note: review.note,
    comment: buildJudgeComment({ verdict: review.verdict, note: review.note, outcome }),
    judgeAgent,
    skipped: null,
  };
}
