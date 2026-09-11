/**
 * The task screen. It owns the state the pieces share — which tab is open, what
 * is in the composer, which plan tasks are still ticked — and mounts everything
 * else. Each region below is its own component; when a rule about how a region
 * reads changes, it changes there, not here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { workModeMetaFor, nextWorkMode } from "@/lib/work-mode-meta";
import type { DocumentRevision, IssueDocument, IssueWorkMode, ToderoPlan } from "@todero/shared";
import "./work-item.css";
import { turnSentence, type TurnActionId } from "./turn-sentence";
import { parseWorkItemBrief } from "./work-item-brief";
import { WorkItemTurnBar } from "./WorkItemTurnBar";
import { WorkItemHeader } from "./WorkItemHeader";
import { WorkItemBody } from "./WorkItemBody";
import { WorkItemChain } from "./WorkItemChain";
import { WorkItemTabs } from "./WorkItemTabs";
import { WorkItemThread } from "./WorkItemThread";
import { WorkItemDeliverable } from "./WorkItemDeliverable";
import { WorkItemPlanTab } from "./WorkItemPlanTab";
import { WorkItemReviewCard } from "./WorkItemReviewCard";
import { WorkItemComposer, type WorkItemAgentOption } from "./WorkItemComposer";
import { defaultTabFor, resolveTab, type WorkItemTab } from "./work-item-tabs";
import { buildThreadItems, lastVerdict } from "./work-item-thread";
import { deliverableVersions } from "./work-item-deliverable";
import type { ChainLink } from "./work-item-chain";
import type { ComposerChip } from "./work-item-chips";
import {
  TITLE_PLACEHOLDER,
  commitWorkItemStatus,
  taskRowLabel,
  type WorkItemActivityItem,
  type WorkItemBlockedBy,
  type WorkItemChecklistItem,
  type WorkItemSection,
  type WorkItemStatus,
  type WorkItemTaskRow,
  type WorkItemTrailEntry,
  type WorkItemType,
} from "./work-item-model";

export type { WorkItemAgentOption };

export type WorkItemViewProps = {
  identifier: string;
  type: WorkItemType;
  title: string;
  body: string;
  /** False on the onboarding first task, whose description is the agent's brief. */
  bodyEditable?: boolean;
  /** False on the onboarding first task, which is always the Brief. */
  typeEditable?: boolean;
  /** Mission › Feature › Task. Empty when the task hangs off no feature. */
  chain?: ChainLink[];
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
  /** The work itself, as the Deliverable tab shows it. */
  outputDocument?: IssueDocument | null;
  outputDocumentRevisions?: DocumentRevision[];
  /** The manager's rewritten brief, shown under a sent-back verdict. */
  guidance?: string | null;
  /** Which review round this is, once the work has been round the loop. */
  reviewRound?: number | null;
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

export function WorkItemView(props: WorkItemViewProps) {
  const {
    identifier,
    type,
    title,
    body,
    bodyEditable = true,
    typeEditable = true,
    chain = [],
    plan = null,
    planApprovable = false,
    tasks = [],
    nextProjectSuggestion = null,
    reviewPending = false,
    outputDocument = null,
    outputDocumentRevisions = [],
    guidance = null,
    reviewRound = null,
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
  const [agentListOpen, setAgentListOpen] = useState(false);
  const caption = statusCaption ?? staleStatusCaption ?? null;
  const modeMeta = workModeMetaFor(workMode);

  const hasDeliverable = Boolean(outputDocument);
  const hasPlan = Boolean(plan);
  // The output has its own tab the moment work is handed in, and that tab is
  // what opens. Picking another one sticks until the hand-in state changes.
  const [pickedTab, setPickedTab] = useState<WorkItemTab | null>(null);
  useEffect(() => {
    setPickedTab(null);
  }, [reviewPending, planApprovable, status]);
  const activeTab = resolveTab(
    pickedTab ?? defaultTabFor({ hasDeliverable, hasPlan, reviewPending, planApprovable, status }),
    { hasDeliverable, hasPlan },
  );

  // A parent is waiting on its own plan while any task it made is still open.
  const openChildren = useMemo(
    () => tasks.filter((task) => task.status !== "done" && task.status !== "cancelled"),
    [tasks],
  );
  // A task made from a plan carries a brief written for the model. The person
  // reads it as labelled lines; the standing instruction in it is machinery and
  // belongs to what the agent sees, not to the body. Editing still opens the
  // brief as it was written — the card reshapes how it reads, never what it says.
  const brief = useMemo(() => {
    const parsed = parseWorkItemBrief(body);
    return parsed.lines.length > 0 ? parsed : null;
  }, [body]);
  const planTaskCount = plan?.tasks.length ?? 0;
  const keptPlanTasks = useMemo(
    () => (plan ? plan.tasks.filter((task) => !droppedPlanTasks.has(task.id)) : []),
    [plan, droppedPlanTasks],
  );

  // Which version the hand-in card offers to open: the newest one there is.
  const handedInVersion = useMemo(() => {
    if (!outputDocument) return null;
    return deliverableVersions(outputDocument, outputDocumentRevisions)[0]?.number ?? null;
  }, [outputDocument, outputDocumentRevisions]);

  const threadItems = useMemo(
    () => buildThreadItems({ activity, reviewPending, handedInVersion }),
    [activity, reviewPending, handedInVersion],
  );
  const verdictItem = useMemo(() => lastVerdict(threadItems), [threadItems]);

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
   * card, and as the composer chip of the same name. Asking for changes on a
   * plan is not the same move as sending a hand-in back, so it goes to the
   * plan's own path.
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
    const result = commitWorkItemStatus({ status: next, assigned: Boolean(assigneeId), blockedBy });
    if (!result.ok) {
      setStatusCaption(result.caption);
      return;
    }
    setStatusCaption(null);
    onStatusChange?.(next);
  }

  function submitComment() {
    const trimmed = comment.trim();
    if (!trimmed) return;
    onComment?.(trimmed);
    setComment("");
    setAgentListOpen(false);
  }

  /** A chip either presses the bar's button, or opens a sentence to finish. */
  function pickChip(chip: ComposerChip) {
    if (chip.action) {
      runTurnAction(chip.action);
      return;
    }
    setComment((prev) => (prev.trim() ? prev : (chip.opener ?? "")));
    composerRef.current?.focus();
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
        <WorkItemHeader
          type={type}
          typeEditable={typeEditable}
          trail={trail}
          status={status}
          // One status vocabulary: the chip says one of the six words, plus
          // Queued for a task waiting behind another — the same computed label
          // the Tasks list uses. Which task it waits behind is the turn bar's
          // line, so the chip does not repeat it.
          chip={taskRowLabel({ status, queued: blockedBy?.kind === "item" })}
          caption={caption}
          onTypeChange={onTypeChange}
          onStatusPick={tryStatus}
        />

        <WorkItemChain chain={chain} />

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
          <WorkItemBody
            body={body}
            bodyEditable={bodyEditable}
            brief={brief}
            editing={editingBody}
            bodyDraft={bodyDraft}
            onBodyDraftChange={setBodyDraft}
            onStartEditing={() => {
              setBodyDraft(body);
              setEditingBody(true);
            }}
            onSave={() => {
              setEditingBody(false);
              if (bodyDraft !== body) onBodySave?.(bodyDraft);
            }}
            sections={sections}
            tasks={tasks}
            checklist={checklist}
          />
        </div>
      </div>

      <div className="work-item-log-split" />

      <div className="work-item-log" data-testid="work-item-log">
        <WorkItemTabs
          activeTab={activeTab}
          onTabChange={setPickedTab}
          hasDeliverable={hasDeliverable}
          hasPlan={hasPlan}
        >
          {activeTab === "conversation" ? (
            <WorkItemThread
              items={threadItems}
              onOpenDeliverable={() => setPickedTab("deliverable")}
              reviewRound={reviewRound}
              guidance={guidance}
            />
          ) : null}
          {activeTab === "deliverable" && outputDocument ? (
            <WorkItemDeliverable
              document={outputDocument}
              revisions={outputDocumentRevisions}
              reviewPending={reviewPending}
              accepted={status === "done"}
            />
          ) : null}
          {activeTab === "plan" && plan ? (
            <WorkItemPlanTab
              plan={plan}
              approvable={planApprovable}
              tasks={tasks}
              kept={droppedPlanTasks.size > 0 || planApprovable ? new Set(keptPlanTasks.map((task) => task.id)) : undefined}
              onToggleTask={(taskId) => {
                setDroppedPlanTasks((prev) => {
                  const next = new Set(prev);
                  if (next.has(taskId)) next.delete(taskId);
                  else next.add(taskId);
                  return next;
                });
              }}
              onApprove={() => runTurnAction("approve")}
              onAskForChanges={askForPlanChanges}
            />
          ) : null}
        </WorkItemTabs>

        {reviewPending && status === "blocked" ? (
          <WorkItemReviewCard
            verdict={verdictItem?.verdict ?? null}
            reviewerName={verdictItem?.name ?? null}
            onAccept={onAccept}
            onSendBack={onSendBack}
            sendBackOpen={sendBackOpen}
            onSendBackOpenChange={setSendBackOpen}
          />
        ) : null}

        {/* The turn bar already says who is writing. This line adds only the
            part it does not carry, where the person is waiting for it. */}
        {agentWorking ? (
          <p className="work-item-working" data-testid="work-item-working">
            The first reply after a pause can take a minute while the model loads.
          </p>
        ) : null}

        {status === "done" && nextProjectSuggestion ? (
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
        ) : null}

        <WorkItemComposer
          value={comment}
          onChange={setComment}
          onSend={submitComment}
          chips={{ actions: turn.actions.map((action) => action.id), status, reviewPending, planPending: planPending && planApprovable }}
          onChip={pickChip}
          agentOptions={agentOptions}
          agentListOpen={agentListOpen}
          onAgentListOpen={setAgentListOpen}
          onPickAgent={pickAgent}
          onAttach={onAttach}
          modeLabel={modeMeta.label}
          onModeChange={() => onWorkModeChange?.(nextWorkMode(workMode))}
          inputRef={composerRef}
        />
      </div>
    </div>
  );
}
