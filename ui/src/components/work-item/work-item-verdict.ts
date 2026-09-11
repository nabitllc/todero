import type { IssueComment } from "@todero/shared";

/**
 * How many rounds the reviewer gets before the decision comes to the person.
 * Mirrors `JUDGE_MAX_FAIL_ROUNDS` on the server; the card only ever reads it.
 */
export const REVIEW_ROUNDS = 2;

/**
 * Verdict extracted from a reviewer's comment.
 */
export interface VerdictInfo {
  verdict: "pass" | "fail";
  outcome: "accept" | "handoff" | "revise" | "exhausted";
  note: string;
  round?: number;
}

/**
 * Parse the verdict from a reviewer's comment body.
 * The comment body starts with one of four known strings:
 * - "I reviewed this and it does what the task asked, so I accepted it." (pass+accept)
 * - "I reviewed this and it does what the task asked. It is ready for you to accept." (pass+handoff)
 * - "I reviewed this and it is not finished yet. Sending it back with what to change." (fail+revise)
 * - "I reviewed this twice and it is still not there. Over to you." (fail+exhausted)
 *
 * The note (if present) comes after a double newline.
 */
export function parseVerdictFromComment(comment: { body?: IssueComment["body"] | null }): VerdictInfo | null {
  if (!comment.body) return null;

  const body = comment.body.trim();

  // Extract note (text after first \n\n)
  const [head, ...noteParts] = body.split("\n\n");
  const note = noteParts.join("\n\n").trim();

  // Match verdict strings
  if (head.includes("I reviewed this and it does what the task asked, so I accepted it.")) {
    return { verdict: "pass", outcome: "accept", note };
  }
  if (head.includes("I reviewed this and it does what the task asked. It is ready for you to accept.")) {
    return { verdict: "pass", outcome: "handoff", note };
  }
  if (head.includes("I reviewed this and it is not finished yet. Sending it back with what to change.")) {
    return { verdict: "fail", outcome: "revise", note };
  }
  if (head.includes("I reviewed this twice and it is still not there. Over to you.")) {
    return { verdict: "fail", outcome: "exhausted", note };
  }

  return null;
}

/**
 * Extract the judge fail round count from the issue description markers.
 * Returns the round number (1-based) or null if no rounds found.
 */
export function extractRoundFromDescription(description: string | null | undefined): number | null {
  if (!description) return null;

  // Match <!-- todero-judge-rounds: N -->
  const match = description.match(/<!--\s*todero-judge-rounds:\s*(\d+)\s*-->/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Format the verdict label.
 * E.g., "Reviewed by Nova's reviewer · Pass" or "Reviewed by Nova's reviewer · Sent back"
 */
export function formatVerdictLabel(verdict: VerdictInfo, reviewerName: string | null): string {
  const name = reviewerName || "Reviewer";
  const action = verdict.verdict === "pass" ? "Pass" : "Sent back";
  return `Reviewed by ${name} · ${action}`;
}
