/**
 * The reviewer's voice, in the conversation but not as a reply: its own card,
 * its own colour, so a person never has to work out whether the paragraph they
 * are reading came from the worker or from the one checking the worker.
 *
 * A sent-back verdict also shows the note the worker was given, so the person
 * sees the same instruction the worker did rather than guessing at it.
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatVerdictLabel, REVIEW_ROUNDS, type VerdictInfo } from "./work-item-verdict";

export type WorkItemVerdictCardProps = {
  verdict: VerdictInfo;
  /** The reviewer's own name, as the thread has it. */
  reviewerName: string | null;
  time?: string | null;
  /** Which round this is. Hidden until the work has been round the loop once. */
  round?: number | null;
  rounds?: number;
  /** The manager's rewritten brief, kept as the task's "What to change". */
  guidance?: string | null;
};

export function WorkItemVerdictCard(props: WorkItemVerdictCardProps) {
  const { verdict, reviewerName, time = null, round = null, rounds = REVIEW_ROUNDS, guidance = null } = props;
  const sentBack = verdict.verdict === "fail";
  const lastRound = sentBack && round !== null && round >= rounds;

  return (
    <section
      className={sentBack ? "work-item-verdict work-item-verdict-sent-back" : "work-item-verdict"}
      data-testid="work-item-verdict-card"
      data-verdict={verdict.verdict}
    >
      <div className="work-item-verdict-head">
        <span className="work-item-verdict-label">{formatVerdictLabel(verdict, reviewerName)}</span>
        {round !== null ? (
          <span className="work-item-verdict-round" data-testid="work-item-verdict-round">
            {round} of {rounds}
          </span>
        ) : null}
        {time ? <span className="work-item-verdict-time">{time}</span> : null}
      </div>

      {verdict.note ? (
        <div className="work-item-verdict-note" data-testid="work-item-verdict-note">
          <Markdown remarkPlugins={[remarkGfm]}>{verdict.note}</Markdown>
        </div>
      ) : null}

      {sentBack && guidance?.trim() ? (
        <div className="work-item-verdict-guidance" data-testid="work-item-verdict-guidance">
          <span className="work-item-verdict-guidance-label">What to change</span>
          <Markdown remarkPlugins={[remarkGfm]}>{guidance}</Markdown>
        </div>
      ) : null}

      {lastRound ? (
        <p className="work-item-verdict-final" data-testid="work-item-verdict-final">
          That was the last review round, so the decision is yours.
        </p>
      ) : null}
    </section>
  );
}
