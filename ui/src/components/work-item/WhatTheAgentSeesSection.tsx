/**
 * The sidebar toggle for "What Nova sees". Closed it is one row; open it shows
 * the last turn's stored context underneath.
 *
 * Nothing is fetched until it is opened — the panel is a curiosity, not part of
 * reading the task, and the task screen already polls enough.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { activityApi } from "../../api/activity";
import { heartbeatsApi } from "../../api/heartbeats";
import { queryKeys } from "@/lib/queryKeys";
import { readAgentContext, whatAgentSeesTitle } from "./agent-context";
import { WhatTheAgentSees } from "./WhatTheAgentSees";
import { PropertySection } from "../issue-properties/primitives";

/** The most recent turn on this task, which is the one the panel shows. */
export function latestRunId(
  runs: Array<{ runId: string; startedAt: string | null; createdAt: string }> | undefined,
): string | null {
  if (!runs || runs.length === 0) return null;
  const sorted = [...runs].sort((left, right) => {
    const leftAt = new Date(left.startedAt ?? left.createdAt).getTime();
    const rightAt = new Date(right.startedAt ?? right.createdAt).getTime();
    return rightAt - leftAt;
  });
  return sorted[0]?.runId ?? null;
}

export function WhatTheAgentSeesSection({
  issueId,
  agentName,
}: {
  issueId: string;
  agentName: string | null;
}) {
  const [open, setOpen] = useState(false);

  // The task page already asks for both of these under these keys, so opening
  // the panel reads what is there rather than fetching a second private copy —
  // and anything the rest of the app refreshes reaches the panel too.
  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
    enabled: open && Boolean(issueId),
  });
  const runId = latestRunId(runs);
  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: queryKeys.runDetail(runId ?? ""),
    queryFn: () => heartbeatsApi.get(runId!),
    enabled: open && Boolean(runId),
  });

  const context = readAgentContext(run?.contextSnapshot ?? null);
  const loading = open && (runsLoading || (Boolean(runId) && runLoading));

  return (
    <PropertySection title="Behind the scenes">
      <button
        type="button"
        className="agent-sees-toggle"
        data-testid="what-the-agent-sees-toggle"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {open ? (
          <ChevronDown className="agent-sees-toggle-icon" />
        ) : (
          <ChevronRight className="agent-sees-toggle-icon" />
        )}
        {whatAgentSeesTitle(agentName)}
      </button>
      {open ? <WhatTheAgentSees context={context} loading={loading} /> : null}
    </PropertySection>
  );
}
