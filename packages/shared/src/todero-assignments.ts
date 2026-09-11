/**
 * The assignments block: a fixed shape the manager writes so Todero can
 * distribute plan children to workers. Like the plan block, tolerant on purpose:
 * accepts task identifiers or titles, agent names case-insensitive, ignores unknown lines.
 * Falls back to Todero's rule when the shape is missing or malformed.
 */

export type ToderoPlanAssignment = {
  /** Task identifier (e.g., "ZZW-2") or title from the plan */
  taskRef: string;
  /** Agent name the task is assigned to */
  agentName: string;
};

export type ToderoPlanAssignments = {
  assignments: ToderoPlanAssignment[];
};

const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)\s*$/;
const ASSIGNMENT_LINE_RE = /^\s*(?:[-*]\s+)?([^:]+?)\s*:\s*(.+)$/;

function findAssignmentsFence(text: string): { inner: string } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i]!.match(FENCE_OPEN_RE);
    if (!open) continue;
    const marker = open[1]![0]!;
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[j]!)) j += 1;
    const inner = lines.slice(i + 1, j).join("\n");
    // Looks like an assignments block if it has an "assignments:" key
    if (/^\s*assignments\s*:/im.test(inner)) {
      return { inner };
    }
    i = j;
  }
  // No fence, but look for `assignments:` key directly
  const assignmentsIndex = lines.findIndex((line) => /^\s*assignments\s*:/i.test(line));
  if (assignmentsIndex === -1) return null;
  // The block runs from `assignments:` to the last meaningful line (blank line or end of file)
  // We'll include everything and let parseAssignmentsInner be tolerant
  let end = assignmentsIndex;
  let lastNonBlank = assignmentsIndex;
  for (let k = assignmentsIndex + 1; k < lines.length; k += 1) {
    const line = lines[k]!;
    if (line.trim()) {
      lastNonBlank = k;
    } else {
      // Stop at a blank line
      break;
    }
  }
  end = lastNonBlank;
  const inner = lines.slice(assignmentsIndex, end + 1).join("\n");
  return { inner };
}

function parseAssignmentsInner(inner: string): ToderoPlanAssignment[] {
  const assignments: ToderoPlanAssignment[] = [];
  const lines = inner.replace(/\r\n?/g, "\n").split("\n");
  let inAssignmentsSection = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim()) continue;

    // Check for assignments: header
    if (/^\s*assignments\s*:/i.test(line)) {
      inAssignmentsSection = true;
      continue;
    }

    // Parse assignment lines (only after "assignments:" section starts)
    // Try to match lines with colon pattern: "task: agent" or "- task: agent"
    if (inAssignmentsSection) {
      const match = line.match(ASSIGNMENT_LINE_RE);
      if (match) {
        const taskRef = match[1]!.trim();
        const agentName = match[2]!.trim();
        if (taskRef && agentName) {
          assignments.push({ taskRef, agentName });
        }
      }
      // Don't stop on non-matching lines; keep looking for more assignments
    }
  }

  return assignments;
}

/**
 * Parse the assignments block from a manager's reply. Returns assignments when
 * found, or null when there is no block or the block has no assignments.
 * Never throws; tolerant on malformed input.
 */
export function parseToderoPlanAssignmentsBlock(text: string): { assignments: ToderoPlanAssignment[] } | null {
  if (!text) return null;
  const fence = findAssignmentsFence(text);
  if (!fence) return null;
  const assignments = parseAssignmentsInner(fence.inner);
  if (assignments.length === 0) return null;
  return { assignments };
}

/**
 * True when the given task reference (identifier or title) matches the search term
 * case-insensitively and tolerates extra whitespace.
 */
export function taskRefMatches(taskRef: string, searchId: string, searchTitle: string): boolean {
  const refLower = taskRef.toLowerCase().trim();
  const idLower = searchId.toLowerCase().trim();
  const titleLower = searchTitle.toLowerCase().trim();
  return refLower === idLower || refLower === titleLower;
}

/**
 * True when the agent name matches case-insensitively.
 */
export function agentNameMatches(agentName: string, searchName: string): boolean {
  return agentName.toLowerCase().trim() === searchName.toLowerCase().trim();
}
