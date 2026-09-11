import type { IssueBlockerAttention } from "@todero/shared";

/**
 * Why a blocked task is held, in one line. Lives here rather than inside
 * `StatusIcon` so every surface that draws a status — the icon, and the
 * Properties panel's own status row — reads the same sentence.
 */
export function blockedAttentionLabel(
  blockerAttention: IssueBlockerAttention | null | undefined,
): string {
  if (!blockerAttention || blockerAttention.state === "none") return "Blocked";

  if (blockerAttention.reason === "active_child") {
    const count = blockerAttention.coveredBlockerCount;
    if (count === 1 && blockerAttention.sampleBlockerIdentifier) {
      return `Blocked · waiting on active sub-task ${blockerAttention.sampleBlockerIdentifier}`;
    }
    if (count === 1) return "Blocked · waiting on 1 active sub-task";
    return `Blocked · waiting on ${count} active sub-tasks`;
  }

  if (blockerAttention.reason === "active_dependency") {
    const count = blockerAttention.coveredBlockerCount;
    if (count === 1 && blockerAttention.sampleBlockerIdentifier) {
      return `Blocked · covered by active dependency ${blockerAttention.sampleBlockerIdentifier}`;
    }
    if (count === 1) return "Blocked · covered by 1 active dependency";
    return `Blocked · covered by ${count} active dependencies`;
  }

  if (blockerAttention.reason === "stalled_review") {
    const count = blockerAttention.stalledBlockerCount;
    const leaf = blockerAttention.sampleStalledBlockerIdentifier ?? blockerAttention.sampleBlockerIdentifier;
    if (count === 1 && leaf) return `Blocked · review stalled on ${leaf}`;
    if (count === 1) return "Blocked · review stalled with no clear next step";
    return `Blocked · ${count} reviews stalled with no clear next step`;
  }

  if (blockerAttention.reason === "attention_required") {
    const count = blockerAttention.attentionBlockerCount || blockerAttention.unresolvedBlockerCount;
    const attentionCopy = `${count} ${count === 1 ? "blocker needs" : "blockers need"} attention`;
    const coveredCount = blockerAttention.coveredBlockerCount;
    if (coveredCount > 0) {
      return `Blocked · ${attentionCopy}; ${coveredCount} covered by active work`;
    }
    return `Blocked · ${attentionCopy}`;
  }

  return "Blocked";
}
