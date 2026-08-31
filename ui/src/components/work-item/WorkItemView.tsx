import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Paperclip } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@/lib/router";
import { relativeTime, formatDateTime } from "@/lib/utils";
import { workModeMetaFor, nextWorkMode } from "@/lib/work-mode-meta";
import type { IssueWorkMode } from "@todero/shared";
import "./work-item.css";
import {
  BOLT_VALUE,
  COMPOSER_PLACEHOLDER,
  EMPTY_ACTIVITY,
  EMPTY_BODY_PLACEHOLDER,
  TITLE_PLACEHOLDER,
  WAITING_ON_YOU,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  agentSummaryRow,
  blockedChipLabel,
  commitWorkItemStatus,
  displayPriority,
  highlightMentions,
  statusFreezesAssignee,
  type WorkItemActivityItem,
  type WorkItemBlockedBy,
  type WorkItemChecklistItem,
  type WorkItemPriority,
  type WorkItemSection,
  type WorkItemStatus,
  type WorkItemTrailEntry,
  type WorkItemType,
} from "./work-item-model";

export type WorkItemAssigneeOption = { id: string; label: string };
export type WorkItemAgentOption = { id: string; name: string };
export type WorkItemBlockerOption = { id: string; identifier: string };

export type WorkItemViewProps = {
  identifier: string;
  type: WorkItemType;
  title: string;
  body: string;
  sections: WorkItemSection[];
  checklist: WorkItemChecklistItem[];
  trail: WorkItemTrailEntry[];
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeId: string | null;
  assigneeLabel: string | null;
  blockedBy: WorkItemBlockedBy | null;
  projectName?: string | null;
  projectCount?: number;
  createdAt: Date | string;
  closedAt?: Date | string | null;
  tokenUsage: string;
  tokenCost: string;
  staleStatusCaption?: string | null;
  activity: WorkItemActivityItem[];
  assigneeOptions: WorkItemAssigneeOption[];
  agentOptions: WorkItemAgentOption[];
  blockerOptions: WorkItemBlockerOption[];
  workMode?: IssueWorkMode;
  onTypeChange?: (type: WorkItemType) => void;
  onTitleSave?: (title: string) => void;
  onBodySave?: (body: string) => void;
  onStatusChange?: (status: WorkItemStatus) => void;
  onPriorityChange?: (priority: WorkItemPriority) => void;
  onAssigneeChange?: (assigneeId: string | null) => void;
  onBlockedByChange?: (blockedBy: WorkItemBlockedBy | null) => void;
  onComment?: (body: string) => void;
  onAttach?: (file: File) => void;
  onWorkModeChange?: (workMode: IssueWorkMode) => void;
  onAgentNotify?: (agentId: string, name: string) => void;
};

function statusClass(status: WorkItemStatus): string {
  if (status === "blocked") return "work-item-status work-item-status-blocked";
  if (status === "in_progress") return "work-item-status work-item-status-progress";
  return "work-item-status work-item-status-muted";
}

function Fact({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="work-item-fact" data-testid={testId}>
      <span className="work-item-fact-label">{label}</span>
      {children}
    </div>
  );
}

export function WorkItemView(props: WorkItemViewProps) {
  const {
    identifier,
    type,
    title,
    body,
    sections,
    checklist,
    trail,
    status,
    priority,
    assigneeId,
    assigneeLabel,
    blockedBy,
    projectName,
    projectCount = 1,
    createdAt,
    closedAt,
    tokenUsage,
    tokenCost,
    staleStatusCaption,
    activity,
    assigneeOptions,
    agentOptions,
    blockerOptions,
    workMode = "standard",
    onTypeChange,
    onTitleSave,
    onBodySave,
    onStatusChange,
    onPriorityChange,
    onAssigneeChange,
    onBlockedByChange,
    onComment,
    onAttach,
    onWorkModeChange,
    onAgentNotify,
  } = props;

  const [typeOpen, setTypeOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [statusCaption, setStatusCaption] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(body);
  const [titleDraft, setTitleDraft] = useState(title);
  const [comment, setComment] = useState("");
  const [agentListOpen, setAgentListOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const frozen = statusFreezesAssignee(status);
  const chip = status === "blocked" ? blockedChipLabel(blockedBy) : WORK_ITEM_STATUS_LABELS[status];
  const caption = statusCaption ?? staleStatusCaption ?? null;
  const modeMeta = workModeMetaFor(workMode);

  const visibleActivity = useMemo(() => {
    return activity.flatMap((item) => {
      if (item.kind !== "agent") return [item];
      const row = agentSummaryRow(item.name ?? "", item.body ?? item.text ?? "");
      if (row.kind === "overflow") {
        return [{ id: item.id, kind: "agent-overflow" as const, text: row.text }];
      }
      return [{ ...item, body: row.summary, name: row.name }];
    });
  }, [activity]);

  function tryStatus(next: WorkItemStatus) {
    const result = commitWorkItemStatus({
      status: next,
      assigned: Boolean(assigneeId),
      blockedBy,
    });
    setStatusOpen(false);
    if (!result.ok) {
      setStatusCaption(result.caption);
      return;
    }
    setStatusCaption(null);
    onStatusChange?.(next);
  }

  function saveBody() {
    setEditingBody(false);
    if (bodyDraft !== body) onBodySave?.(bodyDraft);
  }

  function submitComment(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = comment.trim();
    if (!trimmed) return;
    onComment?.(trimmed);
    setComment("");
    setAgentListOpen(false);
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "@") {
      setAgentListOpen(true);
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      submitComment();
    }
    if (event.key === "Escape") setAgentListOpen(false);
  }

  function pickAgent(agent: WorkItemAgentOption) {
    const at = comment.lastIndexOf("@");
    const next = at >= 0 ? `${comment.slice(0, at)}@${agent.name} ` : `${comment}@${agent.name} `;
    setComment(next);
    setAgentListOpen(false);
    onAgentNotify?.(agent.id, agent.name);
  }

  return (
    <div className="work-item" data-testid="work-item" data-work-item-id={identifier}>
      <div className="work-item-slab" data-testid="work-item-brief">
        <div className="work-item-header">
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="work-item-stamp"
              data-testid="work-item-type-stamp"
              aria-haspopup="menu"
              aria-expanded={typeOpen}
              onClick={() => setTypeOpen((open) => !open)}
            >
              {type}
            </button>
            {typeOpen ? (
              <div className="work-item-stamp-menu" role="menu">
                {WORK_ITEM_TYPES.map((itemType) => (
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
                    onClick={() => tryStatus(itemStatus)}
                  >
                    {WORK_ITEM_STATUS_LABELS[itemStatus]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {editingTitle ? (
          <input
            className="work-item-title"
            data-testid="work-item-title"
            value={titleDraft}
            placeholder={TITLE_PLACEHOLDER}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => {
              setEditingTitle(false);
              if (titleDraft !== title) onTitleSave?.(titleDraft);
            }}
            autoFocus
          />
        ) : (
          <h1
            className="work-item-title"
            data-testid="work-item-title"
            onClick={() => {
              setTitleDraft(title);
              setEditingTitle(true);
            }}
          >
            {titleDraft.trim() ? titleDraft : TITLE_PLACEHOLDER}
          </h1>
        )}

        <div className="work-item-split">
          <div className="work-item-main">
            {editingBody ? (
              <textarea
                className="work-item-body-editor"
                data-testid="work-item-body-editor"
                value={bodyDraft}
                onChange={(event) => setBodyDraft(event.target.value)}
                onBlur={saveBody}
                autoFocus
              />
            ) : (
              <div
                className={body.trim() ? "work-item-body" : "work-item-body work-item-body-empty"}
                data-testid="work-item-body"
                data-work-item-body-present={body.trim() ? "true" : "false"}
                onClick={() => {
                  setBodyDraft(body);
                  setEditingBody(true);
                }}
              >
                {body.trim() ? (
                  <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
                ) : (
                  EMPTY_BODY_PLACEHOLDER
                )}
              </div>
            )}

            {sections.map((section) => (
              <section
                key={section.title}
                className="work-item-section"
                data-testid="work-item-section"
                data-section-title={section.title}
              >
                <h2 className="work-item-section-title">{section.title}</h2>
                <div className="work-item-section-body">
                  <Markdown remarkPlugins={[remarkGfm]}>{section.body}</Markdown>
                </div>
              </section>
            ))}

            {checklist.length > 0 ? (
              <div className="work-item-checklist" data-testid="work-item-checklist">
                {checklist.map((item) => (
                  <label key={item.id} className="work-item-check-item">
                    <input type="checkbox" checked={item.done} readOnly />
                    <span>{item.text}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="work-item-facts" data-testid="work-item-facts">
            <Fact label="Assignee">
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className={assigneeLabel ? "work-item-fact-button" : "work-item-fact-button work-item-fact-muted"}
                  data-testid="work-item-assignee"
                  disabled={frozen}
                  onClick={() => setAssigneeOpen((open) => !open)}
                >
                  {assigneeLabel ?? "Unassigned"}
                </button>
                {assigneeOpen && !frozen ? (
                  <div className="work-item-menu" role="menu">
                    <button
                      type="button"
                      className="work-item-stamp-option"
                      onClick={() => {
                        setAssigneeOpen(false);
                        onAssigneeChange?.(null);
                      }}
                    >
                      Unassigned
                    </button>
                    {assigneeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="work-item-stamp-option"
                        onClick={() => {
                          setAssigneeOpen(false);
                          onAssigneeChange?.(option.id);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </Fact>

            {priority !== "none" ? (
              <Fact label="Priority">
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className={
                      priority === "critical"
                        ? "work-item-fact-button work-item-fact-alert"
                        : "work-item-fact-button"
                    }
                    data-testid="work-item-priority"
                    onClick={() => setPriorityOpen((open) => !open)}
                  >
                    {WORK_ITEM_PRIORITY_LABELS[priority]}
                  </button>
                  {priorityOpen ? (
                    <div className="work-item-menu" role="menu">
                      {WORK_ITEM_PRIORITIES.map((itemPriority) => (
                        <button
                          key={itemPriority}
                          type="button"
                          className="work-item-stamp-option"
                          onClick={() => {
                            setPriorityOpen(false);
                            onPriorityChange?.(itemPriority);
                          }}
                        >
                          {WORK_ITEM_PRIORITY_LABELS[itemPriority]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Fact>
            ) : (
              <Fact label="Priority">
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="work-item-fact-button work-item-fact-empty"
                    data-testid="work-item-priority"
                    onClick={() => setPriorityOpen((open) => !open)}
                  >
                    {""}
                  </button>
                  {priorityOpen ? (
                    <div className="work-item-menu" role="menu">
                      {WORK_ITEM_PRIORITIES.map((itemPriority) => (
                        <button
                          key={itemPriority}
                          type="button"
                          className="work-item-stamp-option"
                          onClick={() => {
                            setPriorityOpen(false);
                            onPriorityChange?.(itemPriority);
                          }}
                        >
                          {WORK_ITEM_PRIORITY_LABELS[itemPriority]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Fact>
            )}

            <Fact label="Blocked by">
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className={blockedBy ? "work-item-fact-button" : "work-item-fact-button work-item-fact-muted"}
                  data-testid="work-item-blocked-by"
                  onClick={() => setBlockedOpen((open) => !open)}
                >
                  {blockedBy?.kind === "waiting-on-you"
                    ? WAITING_ON_YOU
                    : blockedBy?.kind === "item"
                      ? blockedBy.identifier
                      : "—"}
                </button>
                {blockedOpen ? (
                  <div className="work-item-menu" role="menu">
                    <button
                      type="button"
                      className="work-item-stamp-option"
                      onClick={() => {
                        setBlockedOpen(false);
                        onBlockedByChange?.(null);
                      }}
                    >
                      —
                    </button>
                    <button
                      type="button"
                      className="work-item-stamp-option"
                      onClick={() => {
                        setBlockedOpen(false);
                        onBlockedByChange?.({ kind: "waiting-on-you" });
                      }}
                    >
                      {WAITING_ON_YOU}
                    </button>
                    {blockerOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="work-item-stamp-option"
                        onClick={() => {
                          setBlockedOpen(false);
                          onBlockedByChange?.({
                            kind: "item",
                            id: option.id,
                            identifier: option.identifier,
                          });
                        }}
                      >
                        {option.identifier}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </Fact>

            {projectCount > 1 && projectName ? (
              <Fact label="Project">
                <span className="work-item-fact-value">{projectName}</span>
              </Fact>
            ) : null}

            <Fact label="Created">
              <span className="work-item-fact-value work-item-fact-muted" title={formatDateTime(createdAt)}>
                {relativeTime(createdAt)}
              </span>
            </Fact>

            <Fact label="Closed">
              <span className="work-item-fact-value work-item-fact-muted">
                {closedAt ? relativeTime(closedAt) : "—"}
              </span>
            </Fact>

            <Fact label="Token usage">
              <span className="work-item-fact-value work-item-fact-mono">{tokenUsage}</span>
            </Fact>

            <Fact label="Token cost">
              <span className="work-item-fact-value work-item-fact-mono" data-testid="work-item-token-cost">{tokenCost}</span>
            </Fact>

            <Fact label="Bolt">
              <span className="work-item-bolt" data-testid="work-item-bolt">{BOLT_VALUE}</span>
            </Fact>
          </aside>
        </div>
      </div>

      <div className="work-item-log-split" />

      <div className="work-item-log" data-testid="work-item-log">
        <div className="work-item-activity">
          {visibleActivity.length === 0 ? (
            <div className="work-item-activity-empty">{EMPTY_ACTIVITY}</div>
          ) : (
            visibleActivity.map((item) => {
              if (item.kind === "agent") {
                return (
                  <div key={item.id} className="work-item-agent-row" data-testid="work-item-agent-row">
                    {item.name} {item.body}
                  </div>
                );
              }
              if (item.kind === "agent-overflow" || item.kind === "system") {
                return (
                  <div key={item.id} className="work-item-system" data-testid="work-item-system">
                    {item.text}
                  </div>
                );
              }
              return (
                <div key={item.id} className="work-item-human" data-testid="work-item-human">
                  <div className="work-item-human-meta">
                    <span className="work-item-human-name">{item.name}</span>
                    <span className="work-item-human-time">{item.time}</span>
                  </div>
                  <div className="work-item-human-body">
                    {highlightMentions(item.body ?? "").map((part, index) =>
                      part.mention ? (
                        <span key={`${item.id}-${index}`} className="work-item-mention">
                          {part.text}
                        </span>
                      ) : (
                        <span key={`${item.id}-${index}`}>{part.text}</span>
                      ),
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form className="work-item-composer" data-testid="work-item-composer" onSubmit={submitComment}>
          <textarea
            className="work-item-composer-input"
            data-testid="work-item-composer-input"
            placeholder={COMPOSER_PLACEHOLDER}
            value={comment}
            onChange={(event) => {
              setComment(event.target.value);
              if (event.target.value.endsWith("@")) setAgentListOpen(true);
            }}
            onKeyDown={onComposerKey}
          />
          {agentListOpen ? (
            <div className="work-item-agent-list" data-testid="work-item-agent-list">
              {agentOptions.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className="work-item-agent-option"
                  onClick={() => pickAgent(agent)}
                >
                  {agent.name}
                </button>
              ))}
            </div>
          ) : null}
          <div className="work-item-composer-row">
            <button
              type="button"
              className="work-item-attach"
              aria-label="Attach"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="work-item-attach-icon" />
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAttach?.(file);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="work-item-auto"
              data-testid="work-item-auto-mode"
              onClick={() => onWorkModeChange?.(nextWorkMode(workMode))}
            >
              {modeMeta.label === "Auto mode" ? "Auto mode" : modeMeta.label}
            </button>
            <button type="submit" className="work-item-send">
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { displayPriority };
