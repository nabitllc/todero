/**
 * The line above the title: what kind of item this is, where it sits, and which
 * of the six status words it is in. Lifted out of the card whole — nothing here
 * changed when the tabs arrived, and the card had no room left to hold it.
 */
import { useState } from "react";
import { Link } from "@/lib/router";
import {
  WORK_ITEM_CHOOSABLE_TYPES,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUSES,
  type WorkItemStatus,
  type WorkItemTrailEntry,
  type WorkItemType,
} from "./work-item-model";

function statusClass(status: WorkItemStatus): string {
  if (status === "blocked") return "work-item-status work-item-status-blocked";
  if (status === "in_progress") return "work-item-status work-item-status-progress";
  return "work-item-status work-item-status-muted";
}

export type WorkItemHeaderProps = {
  type: WorkItemType;
  typeEditable: boolean;
  trail: WorkItemTrailEntry[];
  status: WorkItemStatus;
  /** The word on the chip: one of the six, or Queued behind another task. */
  chip: string;
  caption: string | null;
  onTypeChange?: (type: WorkItemType) => void;
  onStatusPick: (status: WorkItemStatus) => void;
};

export function WorkItemHeader(props: WorkItemHeaderProps) {
  const { type, typeEditable, trail, status, chip, caption, onTypeChange, onStatusPick } = props;
  const [typeOpen, setTypeOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <div className="work-item-header">
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="work-item-stamp"
          data-testid="work-item-type-stamp"
          aria-haspopup={typeEditable ? "menu" : undefined}
          aria-expanded={typeEditable ? typeOpen : undefined}
          disabled={!typeEditable}
          data-work-item-type-editable={typeEditable ? "true" : "false"}
          onClick={() => {
            if (!typeEditable) return;
            setTypeOpen((open) => !open);
          }}
        >
          {type}
        </button>
        {typeEditable && typeOpen ? (
          <div className="work-item-stamp-menu" role="menu">
            {WORK_ITEM_CHOOSABLE_TYPES.map((itemType) => (
              <button
                key={itemType}
                type="button"
                role="menuitem"
                className="work-item-stamp-option"
                aria-selected={itemType === type}
                onClick={() => {
                  setTypeOpen(false);
                  onTypeChange?.(itemType);
                }}
              >
                {itemType}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <nav className="work-item-trail" data-testid="work-item-trail" aria-label="Work item">
        {trail.map((entry, index) => (
          <span key={entry.id}>
            {index > 0 ? <span className="work-item-trail-sep"> › </span> : null}
            {entry.current ? (
              <span className="work-item-trail-current">{entry.identifier}</span>
            ) : (
              <Link to={entry.href}>{entry.identifier}</Link>
            )}
          </span>
        ))}
      </nav>

      <div className="work-item-status-wrap" style={{ position: "relative" }}>
        <button
          type="button"
          className={statusClass(status)}
          data-testid="work-item-status"
          aria-haspopup="menu"
          aria-expanded={statusOpen}
          onClick={() => setStatusOpen((open) => !open)}
        >
          {chip}
        </button>
        {caption ? (
          <div className="work-item-status-caption" data-testid="work-item-status-caption">
            {caption}
          </div>
        ) : null}
        {statusOpen ? (
          <div className="work-item-status-menu" role="menu">
            {WORK_ITEM_STATUSES.map((itemStatus) => (
              <button
                key={itemStatus}
                type="button"
                role="menuitem"
                className="work-item-stamp-option"
                onClick={() => {
                  setStatusOpen(false);
                  onStatusPick(itemStatus);
                }}
              >
                {WORK_ITEM_STATUS_LABELS[itemStatus]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
