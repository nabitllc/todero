/**
 * The work a task builds on.
 *
 * A plan's `after:` line becomes a real dependency at approval: the task cannot
 * start until the tasks before it are done. That was enforced for *order* and
 * ignored for *content* — the gate opened when the earlier task finished, and
 * the work it finished never arrived. Observed 2026-09-20: the reviewer asked
 * five times for the drafts it was supposed to review, and the project ended
 * with two of five tasks blocked.
 *
 * So when a task wakes, it is handed the finished work of every task it waited
 * on. Direct predecessors only — a chain of five would otherwise carry five
 * hand-ins into the last one. It is written on the task as its own document, so
 * a person, the API and the improvement-loop check can all see what the agent
 * was given, and it is rebuilt on every wake, so a task that was sent back and
 * redone is what the tasks after it read next turn.
 *
 * The decision and the reasoning: doc/plans/2026-09-20-dependency-handoff.md.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@todero/db";
import { issueRelations, issues } from "@todero/db";
import { documentService } from "../services/documents.js";
import { CONVERSATION_OUTPUT_DOCUMENT_KEY } from "./conversation-outcome.js";
import { writeIssueDocumentOnLatest } from "./issue-document-write.js";

/** Where the work a task builds on is kept, on the task itself. */
export const TASK_INPUTS_DOCUMENT_KEY = "inputs";

/** What a person sees in the task's document list. */
export const TASK_INPUTS_DOCUMENT_TITLE = "Work this task builds on";

/** One task that had to finish before this one could start. */
export type PredecessorTask = {
  id: string;
  identifier: string | null;
  title: string;
};

/** One predecessor's finished work. */
export type TaskInput = {
  issueId: string;
  identifier: string | null;
  title: string;
  body: string;
};

/**
 * The three things this needs from the database, kept behind small functions so
 * the rules can be tested without one.
 */
export type TaskInputsDeps = {
  /** The tasks this one waited on — direct only, never their own predecessors. */
  listDirectPredecessors: (issueId: string) => Promise<PredecessorTask[]>;
  /** What a task handed in, or null when it handed in nothing. */
  readOutput: (issueId: string) => Promise<string | null>;
  /** What this task's own hand-off document says now, or null when it has none. */
  readCurrentInputs: (issueId: string) => Promise<string | null>;
  /** Put the block on the task as its own document. */
  writeInputsDocument: (input: { issueId: string; body: string }) => Promise<unknown>;
  /** Said out loud when the document could not be written. */
  onWriteFailed?: (error: unknown) => void;
};

/** How a predecessor is named: "ZZF-3 — Write initial drafts". */
function label(input: { identifier: string | null; title: string }): string {
  const identifier = input.identifier?.trim();
  const title = input.title?.trim();
  if (identifier && title) return `${identifier} — ${title}`;
  return identifier || title || "an earlier task";
}

/** The document a person opens on the task, in the order the work was done. */
export function buildTaskInputsDocumentBody(inputs: TaskInput[]): string {
  const sections = inputs.map((input) => `## ${label(input)}\n\n${input.body.trim()}`);
  return [
    "This is what the tasks before this one handed in. Todero rewrites it every time this task wakes, so it always shows the newest version.",
    ...sections,
  ].join("\n\n");
}

/** Every direct predecessor's finished work, newest version, in plan order. */
export async function collectTaskInputs(deps: TaskInputsDeps, issueId: string): Promise<TaskInput[]> {
  const predecessors = await deps.listDirectPredecessors(issueId);
  const inputs: TaskInput[] = [];
  for (const predecessor of predecessors) {
    const body = await deps.readOutput(predecessor.id);
    if (!body || body.trim().length === 0) continue;
    inputs.push({
      issueId: predecessor.id,
      identifier: predecessor.identifier,
      title: predecessor.title,
      body: body.trim(),
    });
  }
  return inputs;
}

/**
 * Collect it and write it on the task. Nothing is written when the task waits
 * on nobody, or when every task it waited on handed in nothing: an empty
 * document would only be a thing to explain.
 *
 * Two things the document must not do to the work it describes.
 *
 * It must not be able to take it away. A person can lock this document, or
 * save an edit to it in the moment between the read and the write, and the
 * documents service refuses the write in both cases. The document is only how
 * a person sees the hand-off; the task still gets the work, and the failed
 * write is said out loud instead of taking the work with it.
 *
 * And it must not grow without end. The work a task builds on is gathered
 * again on every single wake, so an unconditional write would store another
 * full copy of the same text every time — a task that wakes ten times would
 * leave ten identical versions for a person to scroll past. Nothing is written
 * when nothing it says has changed.
 */
export async function syncTaskInputs(deps: TaskInputsDeps, issueId: string): Promise<TaskInput[]> {
  const inputs = await collectTaskInputs(deps, issueId);
  if (inputs.length === 0) return inputs;
  const body = buildTaskInputsDocumentBody(inputs);
  try {
    const current = await deps.readCurrentInputs(issueId);
    if (current?.trim() !== body.trim()) {
      await deps.writeInputsDocument({ issueId, body });
    }
  } catch (error) {
    deps.onWriteFailed?.(error);
  }
  return inputs;
}

/**
 * What a turn calls: gather the work against the database, say out loud
 * anything that went wrong, and hand back whatever was gathered. Neither a
 * failed lookup nor a failed save stops the turn.
 */
export async function gatherTaskInputsForTurn(
  db: Db,
  input: {
    companyId: string;
    issueId: string;
    agentId?: string | null;
    runId?: string | null;
    /** Put in the run's log, with the sentence already written out. */
    onProblem: (error: unknown, said: string) => void;
  },
): Promise<TaskInput[]> {
  const deps = taskInputsDbDeps(db, {
    companyId: input.companyId,
    agentId: input.agentId,
    runId: input.runId,
    // The task still gets the work; only the copy a person can open is missing.
    onWriteFailed: (error: unknown) =>
      input.onProblem(error, "could not save the document that shows the work this task builds on"),
  });
  return syncTaskInputs(deps, input.issueId).catch((error: unknown) => {
    input.onProblem(error, "could not gather the work this task builds on");
    return [] as TaskInput[];
  });
}

/**
 * The real three, against the database.
 *
 * The predecessor lookup is the same shape the readiness check already uses
 * (`listIssueDependencyReadinessMap` in services/issues.ts): the `blocks`
 * relations where this task is the blocked one.
 */
export function taskInputsDbDeps(
  db: Db,
  input: {
    companyId: string;
    agentId?: string | null;
    runId?: string | null;
    onWriteFailed?: (error: unknown) => void;
  },
): TaskInputsDeps {
  const documents = documentService(db);
  return {
    listDirectPredecessors: async (issueId: string) => {
      const rows = await db
        .select({ id: issues.id, identifier: issues.identifier, title: issues.title })
        .from(issueRelations)
        .innerJoin(issues, eq(issueRelations.issueId, issues.id))
        .where(
          and(
            eq(issueRelations.companyId, input.companyId),
            eq(issueRelations.type, "blocks"),
            eq(issueRelations.relatedIssueId, issueId),
          ),
        )
        .orderBy(asc(issues.createdAt));
      return rows.map((row) => ({
        id: row.id,
        identifier: row.identifier ?? null,
        title: row.title ?? "",
      }));
    },
    readOutput: async (issueId: string) => {
      const document = await documents
        .getIssueDocumentByKey(issueId, CONVERSATION_OUTPUT_DOCUMENT_KEY)
        .catch(() => null);
      return document?.body ?? null;
    },
    readCurrentInputs: async (issueId: string) => {
      const document = await documents
        .getIssueDocumentByKey(issueId, TASK_INPUTS_DOCUMENT_KEY)
        .catch(() => null);
      return document?.body ?? null;
    },
    writeInputsDocument: async ({ issueId, body }) =>
      writeIssueDocumentOnLatest(db, {
        issueId,
        key: TASK_INPUTS_DOCUMENT_KEY,
        title: TASK_INPUTS_DOCUMENT_TITLE,
        format: "markdown",
        body,
        changeSummary: "Refreshed from the tasks this one waits on.",
        createdByAgentId: input.agentId ?? null,
        createdByRunId: input.runId ?? null,
      }),
    onWriteFailed: input.onWriteFailed,
  };
}
