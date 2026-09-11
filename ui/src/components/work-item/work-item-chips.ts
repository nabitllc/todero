/**
 * The composer's quick replies. They are computed from the same turn the bar
 * above is computed from, so the two can never offer different things: if the
 * bar has no Accept, no chip says Approve.
 *
 * A chip that has a button in the bar runs that button. A chip that does not
 * writes the opening words into the box and leaves the person to finish the
 * sentence — free text always works, and nothing is ever sent by a chip alone.
 *
 * There are five labels in all — Approve, Send back with note, Ask a question,
 * Give more context, Skip this task — and a plan uses the same two words for
 * the same two moves as a hand-in does, rather than inventing its own.
 */
import type { TurnActionId } from "./turn-sentence";
import type { WorkItemStatus } from "./work-item-model";

export type ComposerChip = {
  id: string;
  label: string;
  /** Runs the bar's button of the same name. */
  action?: TurnActionId;
  /** Puts these words in the box and puts the cursor after them. */
  opener?: string;
};

export type ComposerChipsView = {
  /** The turn bar's own buttons, in its own order. */
  actions: TurnActionId[];
  status: WorkItemStatus;
  reviewPending?: boolean;
  planPending?: boolean;
};

const ASK_A_QUESTION: ComposerChip = { id: "ask", label: "Ask a question", opener: "A question: " };
const GIVE_CONTEXT: ComposerChip = { id: "context", label: "Give more context", opener: "More context: " };
const SKIP: ComposerChip = { id: "skip", label: "Skip this task", opener: "Skip this one for now: " };

export function composerChipsFor(view: ComposerChipsView): ComposerChip[] {
  // Finished work takes no more quick replies. A note still can be typed.
  if (view.status === "done" || view.status === "cancelled") return [];

  const has = (action: TurnActionId) => view.actions.includes(action);

  if (view.reviewPending) {
    const chips: ComposerChip[] = [];
    if (has("accept")) chips.push({ id: "approve", label: "Approve", action: "accept" });
    if (has("send-back")) {
      chips.push({ id: "send-back", label: "Send back with note", action: "send-back" });
    }
    chips.push(ASK_A_QUESTION);
    return chips;
  }

  if (view.planPending) {
    const chips: ComposerChip[] = [];
    if (has("approve")) chips.push({ id: "approve-plan", label: "Approve", action: "approve" });
    if (has("send-back")) {
      chips.push({ id: "plan-changes", label: "Send back with note", action: "send-back" });
    }
    chips.push(ASK_A_QUESTION);
    return chips;
  }

  return [ASK_A_QUESTION, GIVE_CONTEXT, SKIP];
}
