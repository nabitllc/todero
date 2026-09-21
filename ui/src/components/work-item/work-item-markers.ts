/**
 * Todero keeps a few notes to itself at the top of a task's description, as
 * HTML comments. None of them is anybody's reading: every one is taken out
 * before the description reaches a person, whether the task is being shown or
 * opened for editing.
 */

export const TYPE_COMMENT_RE = /<!--\s*todero-type:\s*(Brief|Feature|Story|Task|Bug)\s*-->/i;
export const WAITING_COMMENT_RE = /<!--\s*todero-blocked-by:\s*waiting-on-you\s*-->/i;
export const REVIEW_COMMENT_RE = /<!--\s*todero-review:\s*pending\s*-->/i;
// A hand-in made while the organization was on hold is marked as still owed a
// review. Todero takes the mark off itself once that review has run.
const REVIEW_DEFERRED_COMMENT_RE = /<!--\s*todero-review:\s*deferred\s*-->\s*\n?/gi;
export const PLAN_COMMENT_RE = /<!--\s*todero-plan:\s*pending\s*-->/i;
// The reviewer counts its rounds in the description; the person never needs to
// see the tally.
const JUDGE_ROUNDS_COMMENT_RE = /<!--\s*todero-judge-rounds:\s*\d+\s*-->\s*\n?/gi;
// How many times Todero has had to ask for the plan again. Its own tally.
const PLAN_TRIES_COMMENT_RE = /<!--\s*todero-plan-tries:\s*\d+\s*-->\s*\n?/gi;
export const PLAN_TRIES_VALUE_RE = /<!--\s*todero-plan-tries:\s*(\d+)\s*-->/i;
// Manager mode keeps three more notes to itself in the description: who handed
// the task out, that it is parked on the manager, and that a rewritten brief is
// filed against it.
const MANAGER_ASSIGNED_COMMENT_RE = /<!--\s*todero-assigned-by:\s*[^>]*?-->\s*\n?/gi;
const MANAGER_WAITING_COMMENT_RE = /<!--\s*todero-waiting-for-manager-sendback(?::[^>]*?)?-->\s*\n?/gi;
const MANAGER_GUIDANCE_COMMENT_RE = /<!--\s*todero-has-guidance\s*-->\s*\n?/gi;

export function stripWorkItemMeta(description: string | null | undefined): string {
  return (description ?? "")
    .replace(TYPE_COMMENT_RE, "")
    .replace(WAITING_COMMENT_RE, "")
    .replace(REVIEW_COMMENT_RE, "")
    .replace(REVIEW_DEFERRED_COMMENT_RE, "")
    .replace(PLAN_COMMENT_RE, "")
    .replace(JUDGE_ROUNDS_COMMENT_RE, "")
    .replace(PLAN_TRIES_COMMENT_RE, "")
    .replace(MANAGER_ASSIGNED_COMMENT_RE, "")
    .replace(MANAGER_WAITING_COMMENT_RE, "")
    .replace(MANAGER_GUIDANCE_COMMENT_RE, "")
    .replace(/^\s+/, "");
}
