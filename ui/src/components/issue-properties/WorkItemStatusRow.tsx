import { useState } from "react";
import type { IssueBlockerAttention } from "@todero/shared";
import { blockedAttentionLabel } from "../../lib/blocked-attention";
import { cn } from "../../lib/utils";
import { StatusGlyph } from "../StatusGlyph";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  PANEL_STATUS_OPTIONS,
  panelStatus,
  panelStatusGlyph,
  panelStatusLabel,
  panelStatusOptionLabel,
  panelStatusPatch,
  panelStatusTitle,
  type PanelStatusIssue,
} from "./panel-status";
import { apiStatusFor, type WorkItemStatus } from "../work-item/work-item-model";

/**
 * The Properties panel's Status control. It is deliberately not the generic
 * {@link import("../StatusIcon").StatusIcon}: that one speaks the API's seven
 * raw values, and the panel has to say exactly what the card's chip says.
 * Everything it shows and everything it writes goes through `panel-status`,
 * which is the card's own vocabulary and the card's own rules.
 */
export function WorkItemStatusRow({
  issue,
  blockerAttention,
  onUpdate,
}: {
  issue: PanelStatusIssue;
  blockerAttention?: IssueBlockerAttention | null;
  onUpdate: (data: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);

  const current = panelStatus(issue);
  const label = panelStatusLabel(issue);
  const title = panelStatusTitle(
    label,
    current === "blocked" ? blockedAttentionLabel(blockerAttention) : null,
  );

  function choose(next: WorkItemStatus) {
    const result = panelStatusPatch(issue, next);
    if (!result.ok) {
      setCaption(result.caption);
      return;
    }
    setCaption(null);
    setOpen(false);
    onUpdate(result.patch);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setCaption(null);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="panel-status-trigger"
            aria-label={`Change status (current: ${title})`}
            title={title}
            className="inline-flex min-h-5 min-w-0 cursor-pointer items-center gap-1.5 -mx-1 rounded px-1 py-0.5 transition-colors hover:bg-accent/50"
          >
            <StatusGlyph status={panelStatusGlyph(issue)} size="lg" />
            <span className="min-w-0 truncate text-sm">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-1" align="start">
          {PANEL_STATUS_OPTIONS.map((option) => (
            <Button
              key={option}
              variant="ghost"
              size="sm"
              className={cn("w-full justify-start gap-2 text-xs", option === current && "bg-accent")}
              onClick={() => choose(option)}
            >
              <StatusGlyph status={apiStatusFor(option)} size="lg" />
              {panelStatusOptionLabel(option)}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
      {caption ? (
        <span className="text-xs text-muted-foreground" role="status" data-testid="panel-status-caption">
          {caption}
        </span>
      ) : null}
    </div>
  );
}
