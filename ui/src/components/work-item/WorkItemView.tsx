import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Paperclip } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@/lib/router";
import { workModeMetaFor, nextWorkMode } from "@/lib/work-mode-meta";
import type { IssueWorkMode, ToderoPlan } from "@todero/shared";
import "./work-item.css";
import { planApproveLabel, turnSentence, type TurnActionId } from "./turn-sentence";
import { parseWorkItemBrief } from "./work-item-brief";
import { WorkItemTurnBar } from "./WorkItemTurnBar";
import { WorkItemBriefBlock } from "./WorkItemBriefBlock";
import {
  COMPOSER_PLACEHOLDER,
  EMPTY_ACTIVITY,
  EMPTY_BODY_PLACEHOLDER,
  TITLE_PLACEHOLDER,
  WORK_ITEM_CHOOSABLE_TYPES,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUSES,
  commitWorkItemStatus,
  highlightMentions,
  statusFreezesAssignee,
  type WorkItemActivityItem,
  type WorkItemBlockedBy,
  type WorkItemChecklistItem,
  type WorkItemTaskRow,
  taskRowLabel,
  type WorkItemSection,
  type WorkItemStatus,
  type WorkItemTrailEntry,
  type WorkItemType,
} from "./work-item-model";

export type WorkItemAgentOption = { id: string; name: string };

export type WorkItemViewProps = {
  identifier: string;
  type: WorkItemType;
  title: string;
  body: string;
  /** False on the onboarding first task, whose description is the agent's brief. */
  bodyEditable?: boolean;
  /** False on the onboarding first task, which is always the Brief. */
  typeEditable?: boolean;
  /** The plan the agent proposed, parsed from the task's Plan document. */
  plan?: ToderoPlan | null;
  /** True while the plan is waiting for the person: shows the approval card. */
  planApprovable?: boolean;
  /** Child tasks created from the plan, oldest first. */
  tasks?: WorkItemTaskRow[];
  /** A `Next:` project the agent named in its wrap-up; not offered again once started. */
  nextProjectSuggestion?: string | null;
  /** The agent handed in its output; show Accept / Send back. */
  reviewPending?: boolean;
  /** The agent proposed a plan and is waiting for a yes. */
  planPending?: boolean;
  /** How many tasks block this one; the chip says "N tasks" past one. */
  blockerCount?: number;
  /** A run is live on this task: the agent is writing. */
  agentWorking?: boolean;
  /** The work is handed over and the reviewer has it; the bar says so. */
  reviewRunning?: boolean;
  sections: WorkItemSection[];
  checklist: WorkItemChecklistItem[];
  trail: WorkItemTrailEntry[];
  status: WorkItemStatus;
  assigneeId: string | null;
  assigneeLabel: string | null;
  blockedBy: WorkItemBlockedBy | null;
  /** The agent asked the person something and is waiting for the answer. */
  waitingOnYou?: boolean;
  /** The work is held: the assignee is paused, or a pause sits on the tree. */
  paused?: boolean;
  /** A resume is already in flight, so the Play button stops offering itself. */
  resumePending?: boolean;
  /** The busy timer that makes an agent pick up open work by itself. */
  timerEnabled?: boolean;
  timerIntervalSec?: number;
  staleStatusCaption?: string | null;
  activity: WorkItemActivityItem[];
  agentOptions: WorkItemAgentOption[];
  workMode?: IssueWorkMode;
  // Assignee, Priority, Project, Token usage and cost, Created and Closed are
  // the Properties panel's rows now — the one details panel. The card takes
  // only what its own sentence and chip read.
  onTypeChange?: (type: WorkItemType) => void;
  onTitleSave?: (title: string) => void;
  onBodySave?: (body: string) => void;
  onPlanApprove?: (keep: string[]) => void;
  onPlanChanges?: () => void;
  onStartProject?: (name: string) => void;
  onAccept?: () => void;
  onSendBack?: (note: string) => void;
  onStatusChange?: (status: WorkItemStatus) => void;
  onComment?: (body: string) => void;
  onAttach?: (file: File) => void;
  onWorkModeChange?: (workMode: IssueWorkMode) => void;
  onAgentNotify?: (agentId: string, name: string) => void;
  /** Start the work by hand when the agent's timer is off. */
  onStartNow?: () => void;
  /** Resume paused work. Without it the bar says Paused and offers no button. */
  onResume?: () => void;
};

function statusClass(status: WorkItemStatus): string {
  if (status === "blocked") return "work-item-status work-item-status-blocked";
  if (status === "in_progress") return "work-item-status work-item-status-progress";
  return "work-item-status work-item-status-muted";
}

export function WorkItemView(props: WorkItemViewProps) {
  const {
    identifier,
    type,
    title,
    body,
    bodyEditable = true,
    typeEditable = true,
    plan = null,
    planApprovable = false,
    tasks = [],
    nextProjectSuggestion = null,
    reviewPending = false,
    planPending = false,
    blockerCount = 1,
    agentWorking = false,
    reviewRunning = false,
    sections,
    checklist,
    trail,
    status,
    assigneeId,
    assigneeLabel,
    blockedBy,
    waitingOnYou = false,
    paused = false,
    resumePending = false,
    timerEnabled = true,
    timerIntervalSec,
    staleStatusCaption,
    activity,
    agentOptions,
    workMode = "standard",
    onTypeChange,
    onTitleSave,
    onBodySave,
    onPlanApprove,
    onPlanChanges,
    onStartProject,
    onAccept,
    onSendBack,
    onStatusChange,
    onComment,
    onAttach,
    onWorkModeChange,
    onAgentNotify,
    onStartNow,
    onResume,
  } = props;

  const [typeOpen, setTypeOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusCaption, setStatusCaption] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(body);
  const [titleDraft, setTitleDraft] = useState(title);
  const [comment, setComment] = useState("");
  // Unticked plan tasks. Reset whenever a different plan arrives.
  const [droppedPlanTasks, setDroppedPlanTasks] = useState<Set<string>>(() => new Set());
  const planKey = plan ? plan.tasks.map((task) => task.id + task.title).join("|") : "";
  useEffect(() => {
    setDroppedPlanTasks(new Set());
  }, [planKey]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackNote, setSendBackNote] = useState("");
  const [agentListOpen, setAgentListOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const frozen = statusFreezesAssignee(status);
  // One status vocabulary: the chip says one of the six words, plus Queued for a
  // task waiting behind another — the same computed label the Tasks list uses.
  // Which task it waits behind is the turn bar's line, so the chip does not
  // repeat it.
  const chip = taskRowLabel({ status, queued: blockedBy?.kind === "item" });
  const caption = statusCaption ?? staleStatusCaption ?? null;
  const modeMeta = workModeMetaFor(workMode);
  // A parent is waiting on its own plan while any task it made is still open.
  const openChildren = useMemo(
    () => tasks.filter((task) => task.status !== "done" && task.status !== "cancelled"),
    [tasks],
  );
  // A task made from a plan carries a brief written for the model. The person
  // reads it as labelled lines; the standing instruction in it is machinery and
  // belongs to what Nova sees, not to the body. Editing still opens the brief
  // as it was written — the card reshapes how it reads, never what it says.
  const brief = useMemo(() => {
    const parsed = parseWorkItemBrief(body);
    return parsed.lines.length > 0 ? parsed : null;
  }, [body]);
  const planTaskCount = plan?.tasks.length ?? 0;
  const keptPlanTasks = useMemo(
    () => (plan ? plan.tasks.filter((task) => !droppedPlanTasks.has(task.id)) : []),
    [plan, droppedPlanTasks],
  );

  // An agent reply is the conversation itself, so it renders in full. The
  // one-line summary rule only ever hid what the agent said.
  const visibleActivity = useMemo(() => activity, [activity]);

  // What the bar says and what it offers. Everything it reads is already on the
  // card: status, the three markers, blockers, the tasks the plan made, whether
  // a run is live.
  const turn = useMemo(
    () =>
      turnSentence({
        status,
        blockedBy,
        blockerCount,
        openChildIdentifier: openChildren[0]?.identifier ?? null,
        openChildCount: openChildren.length,
        reviewPending,
        planPending: planPending && planApprovable,
        planTaskCount,
        planTasksKept: keptPlanTasks.length,
        waitingOnYou,
        agentWorking,
        reviewRunning,
        assigneeName: assigneeLabel,
        assigneeId,
        paused,
        canResume: Boolean(onResume) && !resumePending,
        canStartNow: Boolean(onStartNow),
        timerEnabled,
        timerIntervalSec,
      }),
    [
      status,
      blockedBy,
      blockerCount,
      openChildren,
      reviewPending,
      planPending,
      planApprovable,
      planTaskCount,
      keptPlanTasks,
      waitingOnYou,
      agentWorking,
      reviewRunning,
      assigneeLabel,
      assigneeId,
      paused,
      onResume,
      resumePending,
      onStartNow,
      timerEnabled,
      timerIntervalSec,
    ],
  );

  function askForPlanChanges() {
    onPlanChanges?.();
    setComment((prev) => (prev.trim() ? prev : "Please change the plan: "));
    composerRef.current?.focus();
  }

  /**
   * Every button in the bar does the same thing as its twin further down the
   * card. Asking for changes on a plan is not the same move as sending a
   * hand-in back, so it goes to the plan's own path.
   */
  function runTurnAction(id: TurnActionId) {
    if (id === "accept") onAccept?.();
    if (id === "send-back") {
      if (reviewPending) setSendBackOpen(true);
      else askForPlanChanges();
    }
    if (id === "approve") onPlanApprove?.(keptPlanTasks.map((task) => task.id));
    if (id === "answer") composerRef.current?.focus();
    if (id === "start-now") onStartNow?.();
    if (id === "play") onResume?.();
  }

  // A accepts, S opens send back. Hints on hover, never required — so they stay
  // out of the way of anyone typing, and out of the way of the browser's own
  // shortcuts. The handler is held in a ref so the listener is bound once per
  // state rather than on every keystroke that changes the composer.
  const turnActionRef = useRef(runTurnAction);
  turnActionRef.current = runTurnAction;

  useEffect(() => {
    if (!reviewPending && !planPending) return undefined;
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const active = document.activeElement;
      const typing =
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (typing) return;
      const key = event.key.toLowerCase();
      if (key === "a" && reviewPending) {
        event.preventDefault();
        turnActionRef.current("accept");
      }
      if (key === "s") {
        event.preventDefault();
        turnActionRef.current("send-back");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reviewPending, planPending]);

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

        <WorkItemTurnBar turn={turn} onAction={runTurnAction} />

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
            ) : brief ? (
              <WorkItemBriefBlock
                brief={brief}
                editable={bodyEditable}
                onEdit={() => {
                  setBodyDraft(body);
                  setEditingBody(true);
                }}
              />
            ) : (
              <div
                className={body.trim() ? "work-item-body" : "work-item-body work-item-body-empty"}
                data-testid="work-item-body"
                data-work-item-body-present={body.trim() ? "true" : "false"}
                data-work-item-body-editable={bodyEditable ? "true" : "false"}
                onClick={() => {
                  if (!bodyEditable) return;
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

            {tasks.length > 0 && (
              <section className="work-item-section" data-testid="work-item-tasks">
                <h2 className="work-item-section-title">Tasks</h2>
                <ol className="work-item-task-list">
                  {tasks.map((task) => (
                    <li key={task.id} className="work-item-task-row" data-testid="work-item-task-row" data-status={task.status}>
                      <span className={`work-item-task-status work-item-task-status-${task.queued && task.status !== "done" ? "queued" : task.status}`}>
                        {taskRowLabel(task)}
                      </span>
                      <Link to={task.href} className="work-item-task-link">
                        <span className="work-item-task-id">{task.identifier}</span> {task.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            )}

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
                  <div key={item.id} className="work-item-human work-item-agent-reply" data-testid="work-item-agent-row">
                    <div className="work-item-human-meta">
                      <span className="work-item-human-name">{item.name}</span>
                      {item.time ? <span className="work-item-human-time">{item.time}</span> : null}
                    </div>
                    <div className="work-item-human-body">{item.body ?? item.text ?? ""}</div>
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

        {plan && planApprovable && (
          <section className="work-item-plan-card" data-testid="work-item-plan-card">
            <div className="work-item-plan-card-head">
              <span className="work-item-plan-card-label">Proposed plan</span>
              <p className="work-item-plan-goal">
                <span className="work-item-plan-goal-label">Goal</span> {plan.goal}
              </p>
            </div>
            {plan.features.length > 0 && (
              <ul className="work-item-plan-features">
                {plan.features.map((feature) => (
                  <li key={feature.id} className="work-item-plan-feature">
                    <span className="work-item-plan-feature-name">{feature.name}</span>
                    {feature.doneWhen ? <span className="work-item-plan-feature-done"> · done when {feature.doneWhen}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <ul className="work-item-plan-tasks">
              {plan.tasks.map((task) => {
                const kept = !droppedPlanTasks.has(task.id);
                return (
                  <li key={task.id} className="work-item-plan-task">
                    <label className="work-item-plan-task-label">
                      <input
                        type="checkbox"
                        className="work-item-plan-task-check"
                        data-testid="work-item-plan-task-check"
                        data-task-id={task.id}
                        checked={kept}
                        onChange={() => {
                          setDroppedPlanTasks((prev) => {
                            const next = new Set(prev);
                            if (next.has(task.id)) next.delete(task.id);
                            else next.add(task.id);
                            return next;
                          });
                        }}
                      />
                      <span className={kept ? "work-item-plan-task-title" : "work-item-plan-task-title work-item-plan-task-dropped"}>
                        {task.title}
                      </span>
                      {task.feature ? <span className="work-item-plan-task-feature">{task.feature}</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="work-item-plan-actions">
              <button
                type="button"
                className="work-item-plan-approve"
                data-testid="work-item-plan-approve"
                disabled={keptPlanTasks.length === 0}
                onClick={() => runTurnAction("approve")}
              >
                {planApproveLabel(keptPlanTasks.length, planTaskCount)}
              </button>
              <button
                type="button"
                className="work-item-plan-changes"
                data-testid="work-item-plan-changes"
                onClick={askForPlanChanges}
              >
                Ask for changes
              </button>
            </div>
          </section>
        )}

        {reviewPending && status === "blocked" && (
          <section className="work-item-plan-card work-item-review-card" data-testid="work-item-review-card">
            <div className="work-item-plan-card-head">
              <span className="work-item-plan-card-label">Handed in</span>
              <p className="work-item-plan-goal">
                The output is ready. Read it in the thread, or under Artifacts on the right, then accept it or send it back.
              </p>
            </div>
            {sendBackOpen ? (
              <div className="work-item-sendback">
                <textarea
                  className="work-item-composer-input work-item-sendback-input"
                  data-testid="work-item-sendback-note"
                  aria-label="What should change?"
                  placeholder="What should change?"
                  value={sendBackNote}
                  onChange={(event) => setSendBackNote(event.target.value)}
                  autoFocus
                />
                <div className="work-item-plan-actions">
                  <button
                    type="button"
                    className="work-item-plan-approve"
                    data-testid="work-item-sendback-confirm"
                    disabled={!sendBackNote.trim()}
                    onClick={() => {
                      onSendBack?.(sendBackNote.trim());
                      setSendBackNote("");
                      setSendBackOpen(false);
                    }}
                  >
                    Send back
                  </button>
                  <button type="button" className="work-item-plan-changes" onClick={() => setSendBackOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="work-item-plan-actions">
                <button
                  type="button"
                  className="work-item-plan-approve"
                  data-testid="work-item-accept"
                  onClick={() => onAccept?.()}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="work-item-plan-changes"
                  data-testid="work-item-sendback"
                  onClick={() => setSendBackOpen(true)}
                >
                  Send back
                </button>
              </div>
            )}
          </section>
        )}

        {/* The turn bar already says who is writing. This line adds only the
            part it does not carry, where the person is waiting for it. */}
        {agentWorking && (
          <p className="work-item-working" data-testid="work-item-working">
            The first reply after a pause can take a minute while the model loads.
          </p>
        )}

        {status === "done" && nextProjectSuggestion && (
          <section className="work-item-next-card" data-testid="work-item-next-card">
            <span className="work-item-next-card-label">Next</span>
            <p className="work-item-next-line">{nextProjectSuggestion}</p>
            <button
              type="button"
              className="work-item-next-start"
              data-testid="work-item-next-start"
              onClick={() => onStartProject?.(nextProjectSuggestion)}
            >
              Start a project
            </button>
          </section>
        )}

        <form className="work-item-composer" data-testid="work-item-composer" onSubmit={submitComment}>
          <textarea
            ref={composerRef}
            className="work-item-composer-input"
            data-testid="work-item-composer-input"
            aria-label={COMPOSER_PLACEHOLDER}
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
