/**
 * Work apart from talk. The main column carries up to three tabs, and which
 * one opens first is a rule, not a preference: while the task is still being
 * worked the conversation is the thing; the moment work is handed in, the
 * output is.
 */
import type { WorkItemStatus } from "./work-item-model";

export type WorkItemTab = "conversation" | "deliverable" | "plan";

export type WorkItemTabOption = { id: WorkItemTab; label: string };

/** Conversation is always there. The other two appear only with something in them. */
export function tabsFor(view: { hasDeliverable?: boolean; hasPlan?: boolean }): WorkItemTabOption[] {
  const tabs: WorkItemTabOption[] = [{ id: "conversation", label: "Conversation" }];
  if (view.hasDeliverable) tabs.push({ id: "deliverable", label: "Deliverable" });
  if (view.hasPlan) tabs.push({ id: "plan", label: "Plan" });
  return tabs;
}

/**
 * Which tab opens. Whatever is waiting for the person wins: the output the
 * moment it is handed in, the plan while it is still asking for a yes, and the
 * conversation the rest of the time.
 *
 * A finished task opens on its output too, and keeps doing so every time it is
 * opened again: once the work is handed in and accepted, the output is the
 * reason the task is worth looking at. Work that came back to be redone is open
 * work again, so it opens on the conversation, where the note saying what to
 * change is.
 */
export function defaultTabFor(view: {
  hasDeliverable?: boolean;
  hasPlan?: boolean;
  reviewPending?: boolean;
  planApprovable?: boolean;
  /** Where the task stands. A finished one leads with what it produced. */
  status?: WorkItemStatus;
}): WorkItemTab {
  if (view.reviewPending && view.hasDeliverable) return "deliverable";
  if (view.planApprovable && view.hasPlan) return "plan";
  if (view.hasDeliverable && view.status === "done") return "deliverable";
  return "conversation";
}

/**
 * The tab actually shown. A tab that has gone away — the plan was approved, the
 * output was withdrawn — falls back to the conversation rather than a blank panel.
 */
export function resolveTab(
  wanted: WorkItemTab,
  view: { hasDeliverable?: boolean; hasPlan?: boolean },
): WorkItemTab {
  return tabsFor(view).some((tab) => tab.id === wanted) ? wanted : "conversation";
}
