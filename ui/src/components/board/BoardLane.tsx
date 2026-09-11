import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight } from "lucide-react";
import { BOARD_COLUMN_LABELS, rowProgressText, type BoardColumn, type BoardRow } from "../../lib/board-model";
import type { BoardCard as BoardCardModel } from "../../lib/board-view";
import { BoardCard, SortableBoardCard } from "./BoardCard";
import { cn } from "../../lib/utils";

/** The drop target id a column cell registers, so a drop knows where it landed. */
export function laneDropId(rowId: string, column: BoardColumn): string {
  return `lane:${rowId}:${column}`;
}

/** Reads a drop target id back. Returns null for anything that is not one. */
export function parseLaneDropId(id: string): { rowId: string; column: BoardColumn } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== "lane") return null;
  return { rowId: parts[1]!, column: parts[2] as BoardColumn };
}

function LaneCell({
  rowId,
  column,
  cards,
  compact,
  dragEnabled,
  onCardAction,
}: {
  rowId: string;
  column: BoardColumn;
  cards: BoardCardModel[];
  compact: boolean;
  dragEnabled: boolean;
  onCardAction?: (cardId: string, from: BoardColumn, to: BoardColumn) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: laneDropId(rowId, column) });

  return (
    <div
      ref={setNodeRef}
      data-testid={`board-cell-${rowId}-${column}`}
      aria-label={`${BOARD_COLUMN_LABELS[column]}, ${cards.length}`}
      className={cn(
        "flex min-h-(--sz-100px) w-(--sz-260px) shrink-0 snap-start flex-col gap-1 rounded-md p-1.5 transition-colors",
        isOver ? "bg-accent" : "bg-muted/20",
      )}
    >
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        {cards.map((card) =>
          dragEnabled ? (
            <SortableBoardCard key={card.id} card={card} compact={compact} />
          ) : (
            <BoardCard
              key={card.id}
              card={card}
              compact={compact}
              onAction={onCardAction ? (to) => onCardAction(card.id, card.column, to) : undefined}
            />
          ),
        )}
      </SortableContext>
    </div>
  );
}

/**
 * One feature of the plan, across all five steps. Collapsed it keeps only its
 * header and the count standing on each step.
 */
export function BoardLane({
  row,
  columns,
  cards,
  collapsed,
  compact,
  dragEnabled,
  onToggle,
  onCardAction,
}: {
  row: BoardRow;
  columns: readonly BoardColumn[];
  cards: Record<BoardColumn, BoardCardModel[]>;
  collapsed: boolean;
  compact: boolean;
  dragEnabled: boolean;
  onToggle: () => void;
  /** Where there is no dragging, the cards carry buttons that do the same moves. */
  onCardAction?: (cardId: string, from: BoardColumn, to: BoardColumn) => void;
}) {
  const ChevronIcon = collapsed ? ChevronRight : ChevronDown;

  return (
    <section className="flex flex-col gap-1" data-testid={`board-row-${row.id}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="sticky left-0 flex w-full max-w-(--sz-640px) items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/40"
      >
        <ChevronIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-(length:--text-compact) font-semibold text-foreground">{row.title}</span>
        <span className="shrink-0 font-mono text-(length:--text-nano) text-muted-foreground tabular-nums">
          {rowProgressText(row.doneCount, row.totalCount)}
        </span>
        {row.doneWhen && !collapsed ? (
          <span className="hidden truncate text-(length:--text-nano) text-muted-foreground sm:inline">
            {row.doneWhen}
          </span>
        ) : null}
      </button>

      <div className="flex gap-2">
        {columns.map((column) =>
          collapsed ? (
            <div
              key={column}
              data-testid={`board-cell-${row.id}-${column}`}
              className="flex w-(--sz-260px) shrink-0 snap-start items-center justify-center rounded-md bg-muted/20 py-1 font-mono text-(length:--text-nano) text-muted-foreground tabular-nums"
            >
              {cards[column].length}
            </div>
          ) : (
            <LaneCell
              key={column}
              rowId={row.id}
              column={column}
              cards={cards[column]}
              compact={compact}
              dragEnabled={dragEnabled}
              onCardAction={onCardAction}
            />
          ),
        )}
      </div>
    </section>
  );
}
