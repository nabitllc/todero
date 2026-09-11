/**
 * The card under the conversation while a hand-in waits for a decision.
 *
 * Its sentence has to agree with everything else on screen: it points at the
 * Deliverable tab, because that is where the output is now, and when the
 * reviewer has already spoken it says so rather than pretending nobody has
 * looked at the work.
 */
import { useState } from "react";
import type { VerdictInfo } from "./work-item-verdict";

export type WorkItemReviewCardProps = {
  /** The reviewer's last word on this hand-in, if the team has a reviewer. */
  verdict?: VerdictInfo | null;
  reviewerName?: string | null;
  onAccept?: () => void;
  onSendBack?: (note: string) => void;
  /** Held above so the turn bar's Send back opens the same box this one does. */
  sendBackOpen: boolean;
  onSendBackOpenChange: (open: boolean) => void;
};

/** What the card says above its two buttons. */
export function reviewCardLine(verdict: VerdictInfo | null | undefined, reviewerName: string | null): string {
  const who = reviewerName?.trim() || "The reviewer";
  if (verdict?.verdict === "pass") {
    return `${who} read it and says it does what the task asked. Read it under Deliverable, then accept it or send it back.`;
  }
  if (verdict?.verdict === "fail") {
    return `${who} sent it back once already. Read it under Deliverable, then accept it or send it back yourself.`;
  }
  return "The output is ready. Read it under Deliverable, then accept it or send it back.";
}

export function WorkItemReviewCard(props: WorkItemReviewCardProps) {
  const { verdict = null, reviewerName = null, onAccept, onSendBack, sendBackOpen, onSendBackOpenChange } = props;
  const [note, setNote] = useState("");

  return (
    <section className="work-item-plan-card work-item-review-card" data-testid="work-item-review-card">
      <div className="work-item-plan-card-head">
        <span className="work-item-plan-card-label">Handed in</span>
        <p className="work-item-plan-goal">{reviewCardLine(verdict, reviewerName)}</p>
      </div>
      {sendBackOpen ? (
        <div className="work-item-sendback">
          <textarea
            className="work-item-composer-input work-item-sendback-input"
            data-testid="work-item-sendback-note"
            aria-label="What should change?"
            placeholder="What should change?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            autoFocus
          />
          <div className="work-item-plan-actions">
            <button
              type="button"
              className="work-item-plan-approve"
              data-testid="work-item-sendback-confirm"
              disabled={!note.trim()}
              onClick={() => {
                onSendBack?.(note.trim());
                setNote("");
                onSendBackOpenChange(false);
              }}
            >
              Send back
            </button>
            <button
              type="button"
              className="work-item-plan-changes"
              onClick={() => onSendBackOpenChange(false)}
            >
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
            onClick={() => onSendBackOpenChange(true)}
          >
            Send back
          </button>
        </div>
      )}
    </section>
  );
}
