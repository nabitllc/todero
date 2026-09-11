/**
 * Manager send-backs: when a task comes back — from the reviewer or from a
 * person — the manager rewrites the brief and hands it on. This module reads
 * the paragraph out of the manager's reply and keeps the two markers a task
 * carries while that happens.
 *
 * What the manager is asked for is built in `manager-wave.ts`
 * (`buildManagerSendbackInstruction`), the one implementation of that turn.
 */

/**
 * Extract the guidance paragraph (the "What to change" text) from the manager's
 * sendback reply. Looks for the first paragraph after the instruction, before
 * any STATUS or assignments block.
 */
export function parseManagerSendbackGuidance(reply: string): string {
  // Split by lines and look for non-empty content that isn't an assignment block
  const lines = reply.split(/\r?\n/);
  const guidance: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Stop at STATUS or assignments block
    if (line.startsWith("STATUS:") || line.startsWith("assignments:") || line.startsWith("```")) {
      break;
    }

    // Accumulate non-empty lines
    if (line) {
      guidance.push(line);
    } else if (guidance.length > 0) {
      // Stop at first blank line after content starts (end of paragraph)
      break;
    }
  }

  return guidance.join(" ").trim();
}

/**
 * Add a marker to the task description indicating it has guidance from the manager.
 */
export function descriptionWithGuidanceMarker(description: string | null | undefined): string {
  const comment = `<!-- todero-has-guidance -->`;
  if (!description || !description.trim()) {
    return comment;
  }
  // Keep exactly one marker: remove any existing one first
  const cleaned = description.replace(/<!--\s*todero-has-guidance\s*-->\s*/g, "");
  return `${cleaned.trim()}\n${comment}`;
}

/**
 * Check if a description has the guidance marker.
 */
export function hasGuidanceMarker(description: string | null | undefined): boolean {
  if (!description) return false;
  return /<!--\s*todero-has-guidance\s*-->/.test(description);
}

const WAITING_FOR_MANAGER_RE = /<!--\s*todero-waiting-for-manager-sendback(?::\s*([^\s>]+))?\s*-->\s*/;
const WAITING_FOR_MANAGER_RE_G = new RegExp(WAITING_FOR_MANAGER_RE.source, "g");

/**
 * Mark a task as parked on the manager. A task that came back is handed to the
 * manager while it rewrites the brief — Todero cancels a queued turn whose
 * agent does not own the task, so the manager has to hold it — and the marker
 * remembers whose task it was so it can go straight back.
 */
export function descriptionWithWaitingForManagerMarker(
  description: string | null | undefined,
  workerAgentId?: string | null,
): string {
  const worker = (workerAgentId ?? "").trim();
  const comment = worker
    ? `<!-- todero-waiting-for-manager-sendback: ${worker} -->`
    : `<!-- todero-waiting-for-manager-sendback -->`;
  if (!description || !description.trim()) {
    return comment;
  }
  // Keep exactly one marker: remove any existing one first
  const cleaned = description.replace(WAITING_FOR_MANAGER_RE_G, "");
  return `${cleaned.trim()}\n${comment}`;
}

/**
 * Check if a description has the waiting-for-manager marker.
 */
export function isWaitingForManagerSendback(description: string | null | undefined): boolean {
  if (!description) return false;
  return WAITING_FOR_MANAGER_RE.test(description);
}

/** The worker the task belonged to before the manager took it, when recorded. */
export function readWaitingForManagerWorkerId(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(WAITING_FOR_MANAGER_RE);
  const worker = match?.[1]?.trim();
  return worker ? worker : null;
}

/**
 * Remove the waiting-for-manager marker from a description.
 */
export function descriptionWithoutWaitingForManagerMarker(description: string | null | undefined): string {
  if (!description) return "";
  return description.replace(WAITING_FOR_MANAGER_RE_G, "").trim();
}
