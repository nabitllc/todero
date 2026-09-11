import { BOARD_COLUMN_LABELS, wipBadgeText, type BoardColumn, type WipStatus } from "../../lib/board-model";
import { cn } from "../../lib/utils";

/**
 * The step names across the top. Agent working carries the work-in-progress
 * badge per agent — what the machine will serve at once — and turns amber at
 * the limit, because nothing else will start until something finishes.
 */
export function BoardColumnHeaders({
  columns,
  counts,
  wip,
  owners,
}: {
  columns: readonly BoardColumn[];
  counts: Record<BoardColumn, number>;
  wip: WipStatus[];
  owners: Partial<Record<BoardColumn, string[]>>;
}) {
  return (
    <div className="flex gap-2" data-testid="board-column-headers">
      {columns.map((column) => {
        const ownerNames = owners[column] ?? [];
        return (
          <div
            key={column}
            data-testid={`board-column-header-${column}`}
            className="flex w-(--sz-260px) shrink-0 snap-start flex-col gap-0.5 px-1.5 py-1"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-(length:--text-compact) font-semibold uppercase tracking-wide text-muted-foreground">
                {BOARD_COLUMN_LABELS[column]}
              </span>
              <span className="ml-auto font-mono text-(length:--text-nano) text-muted-foreground tabular-nums">
                {counts[column]}
              </span>
            </div>
            {ownerNames.length > 0 ? (
              <span className="truncate text-(length:--text-nano) text-muted-foreground">
                {ownerNames.join(", ")}
              </span>
            ) : null}
            {column === "working" && wip.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {wip.map((status) => (
                  <span
                    key={status.agentId}
                    data-testid={`board-wip-${status.agentId}`}
                    title={`${status.agentName} can work on ${status.limit} at a time`}
                    className={cn(
                      "rounded-sm border border-border px-1 font-mono text-(length:--text-nano) tabular-nums",
                      status.atLimit ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : "text-muted-foreground",
                    )}
                  >
                    {status.agentName}: {wipBadgeText(status)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
