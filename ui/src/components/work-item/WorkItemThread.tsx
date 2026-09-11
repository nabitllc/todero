/**
 * The Conversation tab. One row per thread item, in the shape
 * `buildThreadItems` already decided: a reply, a verdict card, the one-line
 * hand-in card, a grey machinery line, or a cluster of them.
 *
 * Nothing here is labelled "AI" and nothing the person wrote is rewritten.
 */
import type { ReactNode } from "react";
import { EMPTY_ACTIVITY, type WorkItemActivityItem } from "./work-item-model";
import { WorkItemClusterLine } from "./WorkItemClusterLine";
import { WorkItemFormattedReply } from "./WorkItemFormattedReply";
import { WorkItemHandedInCard } from "./WorkItemHandedInCard";
import { WorkItemVerdictCard } from "./WorkItemVerdictCard";

export type WorkItemThreadProps = {
  /** Already clustered and tagged; see `buildThreadItems`. */
  items: WorkItemActivityItem[];
  /** Open the Deliverable tab from the hand-in card. */
  onOpenDeliverable: () => void;
  /** Which review round this is, when the task has been round the loop. */
  reviewRound?: number | null;
  /** How many rounds the reviewer gets before the decision comes to the person. */
  reviewRounds?: number;
  /** The manager's rewritten brief, shown under a sent-back verdict. */
  guidance?: string | null;
};

function Reply({ item, mentions }: { item: WorkItemActivityItem; mentions: boolean }): ReactNode {
  const body = item.body ?? item.text ?? "";
  return (
    <div
      className={item.kind === "agent" ? "work-item-human work-item-agent-reply" : "work-item-human"}
      data-testid={item.kind === "agent" ? "work-item-agent-row" : "work-item-human"}
    >
      <div className="work-item-human-meta">
        <span className="work-item-human-name">{item.name}</span>
        {item.time ? <span className="work-item-human-time">{item.time}</span> : null}
      </div>
      <div className="work-item-human-body">
        <WorkItemFormattedReply body={body} highlight={mentions} />
      </div>
    </div>
  );
}

export function WorkItemThread(props: WorkItemThreadProps) {
  const { items, onOpenDeliverable, reviewRound = null, reviewRounds, guidance = null } = props;

  function renderItem(item: WorkItemActivityItem): ReactNode {
    if (item.kind === "agent") return <Reply item={item} mentions={false} />;
    if (item.kind === "human") return <Reply item={item} mentions />;
    if (item.kind === "handed-in") {
      return (
        <WorkItemHandedInCard version={item.version ?? 1} onOpen={onOpenDeliverable} />
      );
    }
    if (item.kind === "verdict" && item.verdict) {
      return (
        <WorkItemVerdictCard
          verdict={item.verdict}
          reviewerName={item.name ?? null}
          time={item.time ?? null}
          round={reviewRound}
          rounds={reviewRounds}
          guidance={guidance}
        />
      );
    }
    // Machinery is grey and short. A notice that is not routine — a recovery
    // notice — keeps its warning tone here, inside the cluster it folded into.
    return (
      <div
        className={item.tone === "warning" ? "work-item-system work-item-system-warning" : "work-item-system"}
        data-testid="work-item-system"
        data-tone={item.tone ?? "plain"}
      >
        {item.text}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="work-item-activity">
        <div className="work-item-activity-empty">{EMPTY_ACTIVITY}</div>
      </div>
    );
  }

  return (
    <div className="work-item-activity">
      {items.map((item) =>
        item.kind === "cluster" ? (
          <WorkItemClusterLine key={item.id} cluster={item} renderItem={renderItem} />
        ) : (
          <div key={item.id}>{renderItem(item)}</div>
        ),
      )}
    </div>
  );
}
