import { Link } from "@/lib/router";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CircleDashed, Hand, PauseCircle, PenLine } from "lucide-react";
import { Identity } from "../Identity";
import { cn } from "../../lib/utils";
import { cardActionsFor, type BoardColumn } from "../../lib/board-drop";
import type { BoardCard as BoardCardModel } from "../../lib/board-view";

const GLYPHS = {
  writing: { icon: PenLine, label: "writing" },
  review: { icon: CircleDashed, label: "with the reviewer" },
  "your-turn": { icon: Hand, label: "waiting on you" },
  paused: { icon: PauseCircle, label: "paused" },
} as const;

/**
 * One task on the line. Identifier, title, who has it, how long it has stood
 * here, and one glyph. Clicking opens the task; the card never edits in place.
 *
 * Where there is no dragging — a phone, where touch does not drag — the card
 * carries the buttons the drag would have been: the same moves, asked the same
 * way, through the same rules.
 */
export function BoardCard({
  card,
  compact,
  draggable,
  overlay,
  onAction,
}: {
  card: BoardCardModel;
  compact?: boolean;
  draggable?: boolean;
  overlay?: boolean;
  /** Given, the card shows a button per move it can make from where it stands. */
  onAction?: (to: BoardColumn) => void;
}) {
  const glyph = card.glyph ? GLYPHS[card.glyph] : null;
  const GlyphIcon = glyph?.icon;
  const actions = onAction ? cardActionsFor(card.column) : [];

  return (
    <article
      className={cn(
        "rounded-md border border-border bg-card px-2 py-1.5 transition-colors",
        card.column === "done" && "opacity-70",
        draggable && "cursor-grab active:cursor-grabbing",
        overlay && "shadow-md",
      )}
      data-testid={`board-card-${card.identifier}`}
      data-column={card.column}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-(length:--text-nano) text-muted-foreground">{card.identifier}</span>
        {GlyphIcon ? (
          <GlyphIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        {glyph ? <span className="sr-only">{glyph.label}</span> : null}
        {card.timeText ? (
          <span className="ml-auto font-mono text-(length:--text-nano) text-muted-foreground tabular-nums">
            {card.timeText}
          </span>
        ) : null}
      </div>
      <Link
        to={`/issues/${card.identifier}`}
        className={cn(
          "mt-0.5 block text-(length:--text-compact) font-medium text-foreground hover:underline",
          compact ? "truncate" : "line-clamp-2",
        )}
      >
        {card.title}
      </Link>
      {!compact && card.assigneeName ? (
        <Identity name={card.assigneeName} size="xs" className="mt-1 text-muted-foreground" />
      ) : null}
      {actions.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {actions.map((action) => (
            <button
              key={action.to}
              type="button"
              data-testid={`board-card-action-${card.identifier}-${action.to}`}
              onClick={() => onAction?.(action.to)}
              className="rounded-md border border-border px-2 py-1 text-(length:--text-nano) font-medium text-foreground hover:bg-accent"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/** The same card, made draggable. Touch never drags: the phone uses buttons. */
export function SortableBoardCard({ card, compact }: { card: BoardCardModel; compact?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { card },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <BoardCard card={card} compact={compact} draggable />
    </div>
  );
}
