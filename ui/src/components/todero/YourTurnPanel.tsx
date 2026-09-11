import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue } from "@todero/shared";
import { Link } from "@/lib/router";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { createIssueDetailPath } from "@/lib/issueDetailBreadcrumb";
import { queryKeys } from "@/lib/queryKeys";
import { parseWorkItemDescription } from "@/components/work-item/work-item-model";
import { useCompany } from "@/context/CompanyContext";
import { useDialogActions } from "@/context/DialogContext";
import { Button } from "../ui/button";
import { PausedCard } from "./PausedCard";

export type YourTurnKind = "plan" | "review" | "question" | "next";

export type YourTurnRow = {
  id: string;
  identifier: string;
  title: string;
  kind: YourTurnKind;
  href: string;
  /** kind "next" only: the follow-on project the agent named. */
  nextProjectName?: string;
};

export const YOUR_TURN_LABELS: Record<YourTurnKind, string> = {
  plan: "Plan to approve",
  review: "Output to accept",
  question: "Question to answer",
  next: "Follow-on project",
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

/**
 * One row per finished conversation task that named a follow-on project in
 * its wrap-up (the `next` issue document) and has not started one yet.
 * `entries` pairs a done, parentless task with that document's body.
 */
export function nextTurnRows(entries: Array<{ issue: Issue; nextProjectName: string }>): YourTurnRow[] {
  const rows: YourTurnRow[] = [];
  for (const { issue, nextProjectName } of entries) {
    const name = nextProjectName.trim();
    if (issue.status !== "done" || issue.parentId || !name) continue;
    const identifier = issue.identifier ?? issue.id;
    rows.push({
      id: issue.id,
      identifier,
      title: issue.title,
      kind: "next",
      href: createIssueDetailPath(identifier),
      nextProjectName: name,
    });
  }
  return rows.sort((left, right) => left.identifier.localeCompare(right.identifier, undefined, { numeric: true }));
}

function RowActions({
  row,
  companyId,
  onDone,
}: {
  row: YourTurnRow;
  companyId: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<"reply" | "sendback" | null>(null);
  const [text, setText] = useState("");
  const { openNewIssue } = useDialogActions();
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
  const startProject = useMutation({
    mutationFn: async () => {
      const name = row.nextProjectName ?? row.title;
      const project = await projectsApi.create(companyId, { name, status: "in_progress" });
      // Delete the note so this row does not reappear or offer a second
      // project from the same suggestion once one has been started.
      try {
        await issuesApi.deleteDocument(row.id, "next");
      } catch {
        // Best effort — onDone below refreshes the query either way.
      }
      return project;
    },
    onSuccess: (project) => {
      onDone();
      openNewIssue({ projectId: project.id });
    },
  });
  const busy = approve.isPending || accept.isPending || sendBack.isPending || reply.isPending || startProject.isPending;

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
  if (row.kind === "next") {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => startProject.mutate()}
          data-testid="your-turn-start-project"
        >
          Start a project
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
  const { selectedCompany } = useCompany();
  const paused = selectedCompany?.id === companyId && selectedCompany.status === "paused";
  const { data } = useQuery({
    queryKey: ["issues", companyId, "your-turn"],
    queryFn: () => issuesApi.list(companyId, { status: "blocked", includeBlockedBy: true }),
    refetchInterval: 10_000,
  });
  // A finished conversation task may have named a follow-on project in its
  // wrap-up (the `next` document). There are only ever a handful of these —
  // one agent works one project at a time — so a small, capped list of done,
  // parentless tasks is cheap to check individually.
  const { data: nextCandidates } = useQuery({
    queryKey: ["issues", companyId, "your-turn-next"],
    queryFn: async () => {
      const done = await issuesApi.list(companyId, {
        status: "done",
        limit: 20,
        sortField: "updated",
        sortDir: "desc",
      });
      const roots = done.filter((issue) => !issue.parentId);
      const withNext = await Promise.all(
        roots.map(async (issue) => {
          try {
            const doc = await issuesApi.getDocument(issue.id, "next");
            return doc.body?.trim() ? { issue, nextProjectName: doc.body.trim() } : null;
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          }
        }),
      );
      return withNext.filter((entry): entry is { issue: Issue; nextProjectName: string } => entry !== null);
    },
    refetchInterval: 30_000,
  });
  const rows = [...yourTurnRows(data ?? []), ...nextTurnRows(nextCandidates ?? [])];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["issues"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(companyId) });
  };
  const list = (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="your-turn-row" data-kind={row.kind}>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{YOUR_TURN_LABELS[row.kind]}</div>
            <Link to={row.href} className="block truncate text-sm hover:underline">
              <span className="font-mono text-xs text-muted-foreground">{row.identifier}</span>{" "}
              {row.kind === "next" ? row.nextProjectName : row.title}
            </Link>
          </div>
          <RowActions row={row} companyId={companyId} onDone={refresh} />
        </li>
      ))}
    </ul>
  );

  // While the organization is paused the card comes first and carries the
  // Your-turn list inside it, so the person sees what was stopped before what
  // is asked of them. It shows even with nothing waiting: "nothing is waiting
  // on you" is exactly what a person who just pressed Pause wants to know.
  if (paused) {
    return (
      <PausedCard
        companyId={companyId}
        pausedAt={selectedCompany?.pausedAt ?? null}
        waitingOnYou={list}
        waitingOnYouCount={rows.length}
        nextSuggestions={nextCandidates ?? []}
      />
    );
  }

  if (rows.length === 0) return null;
  return (
    <section className="rounded-md border border-border p-3" data-testid="your-turn-panel">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Your turn</h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </div>
      {list}
    </section>
  );
}
