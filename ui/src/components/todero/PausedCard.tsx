import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import type { Issue } from "@todero/shared";
import { agentsApi } from "@/api/agents";
import { companiesApi } from "@/api/companies";
import { heartbeatsApi } from "@/api/heartbeats";
import { issuesApi } from "@/api/issues";
import { createIssueDetailPath } from "@/lib/issueDetailBreadcrumb";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { formatPausedSinceTime } from "./PauseControl";
import {
  inFlightRows,
  queuedRows,
  recommendationRows,
  type RecommendationRow,
} from "./paused-card-model";

/**
 * On a phone the four lists start closed and show only their count; a tap
 * opens one. On anything wider they are open. `matchMedia` is missing in some
 * test and embedded environments, and the honest default there is "not a
 * phone", which keeps the lists visible.
 */
function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 639px)");
    const apply = () => setPhone(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return phone;
}

function Section({
  title,
  count,
  phone,
  testId,
  children,
}: {
  title: string;
  count: number;
  phone: boolean;
  testId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(!phone), [phone]);
  return (
    <section className="border-t border-border pt-2 first:border-t-0 first:pt-0" data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 py-1 text-left text-xs font-medium text-muted-foreground"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid={`${testId}-toggle`}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="text-foreground">{title}</span>
        <span data-testid={`${testId}-count`}>{count}</span>
      </button>
      <div className={cn("pb-1", open ? "block" : "hidden")}>
        {count === 0 ? <p className="py-1 text-xs text-muted-foreground">Nothing here.</p> : children}
      </div>
    </section>
  );
}

function RecommendationTarget({ row }: { row: RecommendationRow }) {
  if (row.target.kind === "agent") {
    return (
      <Link to={`/agents/${row.target.agentId}`} className="text-xs hover:underline">
        {row.target.name}
      </Link>
    );
  }
  return (
    <Link to={createIssueDetailPath(row.target.identifier)} className="font-mono text-xs hover:underline">
      {row.target.identifier}
    </Link>
  );
}

export type PausedCardProps = {
  companyId: string;
  pausedAt: Date | string | null;
  /** The existing Your-turn list, rendered unchanged inside the third section. */
  waitingOnYou: ReactNode;
  waitingOnYouCount: number;
  /** Done, parentless tasks whose wrap-up named a follow-on project. */
  nextSuggestions: Array<{ issue: Issue; nextProjectName: string }>;
};

/**
 * The header card the Inbox grows while the organization is paused: what was
 * already under way, what would start on Play, what is waiting on the person,
 * and what the data suggests is worth a look. Play closes it.
 */
export function PausedCard({
  companyId,
  pausedAt,
  waitingOnYou,
  waitingOnYouCount,
  nextSuggestions,
}: PausedCardProps) {
  const queryClient = useQueryClient();
  const phone = usePhoneLayout();

  const { data: openIssues } = useQuery({
    queryKey: ["issues", companyId, "paused-queued"],
    queryFn: () => issuesApi.list(companyId, { includeBlockedBy: true, limit: 100 }),
    refetchInterval: 30_000,
  });
  const { data: runs } = useQuery({
    queryKey: ["heartbeat-runs", companyId, "paused-in-flight"],
    queryFn: () => heartbeatsApi.list(companyId, undefined, 25),
    refetchInterval: 10_000,
  });
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });

  const issues = openIssues ?? [];
  const inFlight = inFlightRows(runs ?? [], pausedAt);
  const queued = queuedRows(issues);
  const recommendations = recommendationRows({
    issues,
    agents: agents ?? [],
    nextSuggestions,
    pausedAt,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["issues"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const resume = useMutation({
    mutationFn: () => companiesApi.resume(companyId),
    onSuccess: refresh,
  });
  const skip = useMutation({
    mutationFn: (issueId: string) => issuesApi.update(issueId, { status: "cancelled" }),
    onSuccess: refresh,
  });
  const moveUp = useMutation({
    mutationFn: (issueId: string) => issuesApi.update(issueId, { blockedByIssueIds: [] }),
    onSuccess: refresh,
  });

  const since = formatPausedSinceTime(pausedAt);
  const titleById = new Map(issues.map((issue) => [issue.id, issue] as const));

  return (
    <section className="rounded-md border border-border p-3" data-testid="paused-card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Paused</h2>
          <p className="text-xs text-muted-foreground">
            {since ? `Paused since ${since}` : "Paused"} — work already started finishes, nothing new starts.
          </p>
        </div>
        <Button
          size="sm"
          disabled={resume.isPending}
          onClick={() => resume.mutate()}
          data-testid="paused-card-play"
        >
          <Play className="h-3.5 w-3.5" />
          Play
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Section title="Was in flight" count={inFlight.length} phone={phone} testId="paused-in-flight">
          <ul className="divide-y divide-border">
            {inFlight.map((row) => {
              const issue = row.issueId ? titleById.get(row.issueId) : null;
              return (
                <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {issue ? (
                      <Link to={createIssueDetailPath(issue.identifier ?? issue.id)} className="hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">
                          {issue.identifier ?? issue.id}
                        </span>{" "}
                        {issue.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Work with no task attached</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.finished ? "finished" : "finishing"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Queued" count={queued.length} phone={phone} testId="paused-queued">
          <ul className="divide-y divide-border">
            {queued.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
                data-testid="paused-queued-row"
              >
                <div className="min-w-0">
                  <Link to={createIssueDetailPath(row.identifier)} className="block truncate text-sm hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{row.identifier}</span> {row.title}
                  </Link>
                  {row.blockers.length > 0 ? (
                    <div className="text-xs text-muted-foreground">Waits for {row.blockers.join(", ")}</div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={skip.isPending}
                    onClick={() => skip.mutate(row.id)}
                    data-testid="paused-queued-skip"
                  >
                    Skip
                  </Button>
                  {row.blockers.length > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={moveUp.isPending}
                      onClick={() => moveUp.mutate(row.id)}
                      data-testid="paused-queued-move-up"
                    >
                      Move up
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Waiting on you" count={waitingOnYouCount} phone={phone} testId="paused-waiting">
          {waitingOnYou}
        </Section>

        <Section
          title="Recommendations"
          count={recommendations.length}
          phone={phone}
          testId="paused-recommendations"
        >
          <ul className="divide-y divide-border">
            {recommendations.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate">{row.label}</span>
                <RecommendationTarget row={row} />
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </section>
  );
}
