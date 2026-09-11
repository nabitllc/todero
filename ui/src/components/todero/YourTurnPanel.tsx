import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue } from "@todero/shared";
import { Link } from "@/lib/router";
import { issuesApi } from "@/api/issues";
import { createIssueDetailPath } from "@/lib/issueDetailBreadcrumb";
import { parseWorkItemDescription } from "@/components/work-item/work-item-model";
import { Button } from "../ui/button";

export type YourTurnKind = "plan" | "review" | "question";

export type YourTurnRow = {
  id: string;
  identifier: string;
  title: string;
  kind: YourTurnKind;
  href: string;
};

export const YOUR_TURN_LABELS: Record<YourTurnKind, string> = {
  plan: "Plan to approve",
  review: "Output to accept",
  question: "Question to answer",
};

/**
 * Which blocked tasks are waiting on the person, and for what. Read from the
 * description markers the heartbeat writes, so this needs no extra endpoint.
 */
export function yourTurnRows(issues: Issue[]): YourTurnRow[] {
  const rows: YourTurnRow[] = [];
  for (const issue of issues) {
    if (issue.status !== "blocked") continue;
    const parsed = parseWorkItemDescription(issue.description);
    if (!parsed.waitingOnYou) continue;
    const kind: YourTurnKind = parsed.reviewPending ? "review" : parsed.planPending ? "plan" : "question";
    const identifier = issue.identifier ?? issue.id;
    rows.push({ id: issue.id, identifier, title: issue.title, kind, href: createIssueDetailPath(identifier) });
  }
  return rows.sort((left, right) => left.identifier.localeCompare(right.identifier, undefined, { numeric: true }));
}

function RowActions({ row, onDone }: { row: YourTurnRow; onDone: () => void }) {
  const [open, setOpen] = useState<"reply" | "sendback" | null>(null);
  const [text, setText] = useState("");
  const approve = useMutation({ mutationFn: () => issuesApi.approvePlan(row.id, []), onSuccess: onDone });
  const accept = useMutation({ mutationFn: () => issuesApi.update(row.id, { status: "done" }), onSuccess: onDone });
  const sendBack = useMutation({
    mutationFn: async (note: string) => {
      await issuesApi.update(row.id, { status: "todo" });
      await issuesApi.addComment(row.id, note);
    },
    onSuccess: onDone,
  });
  const reply = useMutation({ mutationFn: (body: string) => issuesApi.addComment(row.id, body), onSuccess: onDone });
  const busy = approve.isPending || accept.isPending || sendBack.isPending || reply.isPending;

  if (open) {
    const isReply = open === "reply";
    return (
      <div className="flex w-full flex-col gap-2" data-testid="your-turn-composer">
        <textarea
          className="min-h-16 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          placeholder={isReply ? "Your answer" : "What should change?"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoFocus
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || !text.trim()}
            onClick={() => (isReply ? reply.mutate(text.trim()) : sendBack.mutate(text.trim()))}
            data-testid={isReply ? "your-turn-reply-send" : "your-turn-sendback-send"}
          >
            {isReply ? "Send" : "Send back"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (row.kind === "plan") {
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => approve.mutate()} data-testid="your-turn-approve">
          Approve all
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to={row.href}>Review first</Link>
        </Button>
      </div>
    );
  }
  if (row.kind === "review") {
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => accept.mutate()} data-testid="your-turn-accept">
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen("sendback")} data-testid="your-turn-sendback">
          Send back
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link to={row.href}>Open</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => setOpen("reply")} data-testid="your-turn-reply">
        Answer
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <Link to={row.href}>Open</Link>
      </Button>
    </div>
  );
}

/**
 * The top of the Inbox: everything a local agent is waiting on the person for,
 * with the action right there. Typing only when a button cannot do it.
 */
export function YourTurnPanel({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["issues", companyId, "your-turn"],
    queryFn: () => issuesApi.list(companyId, { status: "blocked", includeBlockedBy: true }),
    refetchInterval: 10_000,
  });
  const rows = yourTurnRows(data ?? []);
  if (rows.length === 0) return null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["issues"] });
  };
  return (
    <section className="rounded-md border border-border p-3" data-testid="your-turn-panel">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Your turn</h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="your-turn-row" data-kind={row.kind}>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{YOUR_TURN_LABELS[row.kind]}</div>
              <Link to={row.href} className="block truncate text-sm hover:underline">
                <span className="font-mono text-xs text-muted-foreground">{row.identifier}</span> {row.title}
              </Link>
            </div>
            <RowActions row={row} onDone={refresh} />
          </li>
        ))}
      </ul>
    </section>
  );
}
