/**
 * The machinery, muted. A run of status and assignment lines with nothing
 * human or agent between them collapses to one grey line — "3 changes · show"
 * — and opens in place. Nothing is hidden, only folded.
 */
import { useState, type ReactNode } from "react";
import type { WorkItemActivityItem } from "./work-item-model";

export type WorkItemClusterLineProps = {
  cluster: WorkItemActivityItem;
  renderItem: (item: WorkItemActivityItem) => ReactNode;
};

/** "3 changes", "1 change" — the count the collapsed line leads with. */
export function clusterLabel(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

export function WorkItemClusterLine({ cluster, renderItem }: WorkItemClusterLineProps) {
  const [open, setOpen] = useState(false);
  const items = cluster.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="work-item-cluster" data-testid="work-item-cluster">
      <button
        type="button"
        className="work-item-cluster-line"
        data-testid="work-item-cluster-toggle"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {clusterLabel(items.length)} · {open ? "hide" : "show"}
      </button>
      {open ? (
        <div className="work-item-cluster-items" data-testid="work-item-cluster-items">
          {items.map((item) => (
            <div key={item.id}>{renderItem(item)}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
