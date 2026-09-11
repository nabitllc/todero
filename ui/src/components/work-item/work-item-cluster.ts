/**
 * Mute the machinery. A run of status lines, assignment lines and posted
 * notices with nothing human or agent between them is one grey line — "3
 * changes · show" — that opens in place. Nothing is hidden, only folded.
 *
 * A cluster of one stays as it is: a single line does not need a lid.
 *
 * A notice that is not routine keeps the warning tone it arrived with when the
 * cluster is opened, so folding the machinery never flattens a recovery notice
 * into the same grey as "Moved to To do".
 */
import type { WorkItemActivityItem } from "./work-item-model";

const CLUSTERED_KINDS = new Set(["system", "agent-overflow"]);

function fold(run: WorkItemActivityItem[]): WorkItemActivityItem {
  if (run.length === 1) return run[0];
  return {
    id: `cluster-${run[0].id}-${run[run.length - 1].id}`,
    kind: "cluster",
    items: run,
  };
}

export function clusterThread(entries: WorkItemActivityItem[]): WorkItemActivityItem[] {
  if (entries.length === 0) return entries;

  const result: WorkItemActivityItem[] = [];
  let run: WorkItemActivityItem[] = [];

  for (const entry of entries) {
    if (CLUSTERED_KINDS.has(entry.kind)) {
      run.push(entry);
      continue;
    }
    if (run.length > 0) {
      result.push(fold(run));
      run = [];
    }
    result.push(entry);
  }

  if (run.length > 0) result.push(fold(run));

  return result;
}
