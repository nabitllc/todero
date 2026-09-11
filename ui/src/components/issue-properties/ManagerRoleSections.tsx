/**
 * Manager mode, in the task sidebar: who handed a task out, and who the team
 * is. Both only show once the organization has a worker — before that the
 * first agent does everything and there is nobody to name.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import type { Issue } from "@todero/shared";
import { agentsApi } from "../../api/agents";
import { queryKeys } from "../../lib/queryKeys";
import { PropertySection } from "./primitives";

/** The manager the task's description says handed this one out, if any. */
export function readManagerAssignmentMarker(description: string | null): string | null {
  if (!description) return null;
  const match = description.match(/<!--\s*todero-assigned-by:\s*([a-zA-Z0-9\-]+)\s*-->/);
  return match?.[1] ?? null;
}

/** "Assigned by Nova", under the assignee, when the manager named this one. */
export function AssignedByCaption({
  description,
  selectedCompanyId,
}: {
  description: string | null;
  selectedCompanyId?: string;
}) {
  const managerId = readManagerAssignmentMarker(description);
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!managerId && !!selectedCompanyId,
  });

  if (!managerId || !agents) return null;

  const manager = agents.find((agent) => agent.id === managerId);
  if (!manager) return null;

  return <div className="text-xs text-muted-foreground ml-0 mt-1">Assigned by {manager.name}</div>;
}

/** The team on a conversation task: the manager, each worker's open count, the reviewer. */
export function TeamSection({
  childIssues,
  selectedCompanyId,
}: {
  childIssues: Issue[];
  selectedCompanyId?: string;
}) {
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!agents || agents.length === 0) return null;
  // Only once the organization has a worker: before that the first agent does
  // everything and there is no team to list.
  if (!agents.some((agent) => agent.role === "worker")) return null;

  const taskCountByAgent = new Map<string, number>();
  for (const child of childIssues) {
    if (child.assigneeAgentId && child.status !== "done" && child.status !== "cancelled") {
      taskCountByAgent.set(child.assigneeAgentId, (taskCountByAgent.get(child.assigneeAgentId) ?? 0) + 1);
    }
  }

  const manager = agents.find((agent) => agent.role === "ceo");
  const workers = agents
    .filter((agent) => agent.role === "worker")
    .sort((left, right) => left.name.localeCompare(right.name));
  const reviewer = agents.find((agent) => agent.role === "reviewer");

  return (
    <PropertySection title="Team" className="space-y-2">
      {manager && (
        <div className="flex items-center justify-between text-xs">
          <Link to={`/agents/${manager.id}`} className="text-foreground hover:underline">
            {manager.name}
          </Link>
          <span className="text-muted-foreground text-xs">Manager</span>
        </div>
      )}
      {workers.length > 0 && (
        <>
          <div className="text-xs font-medium text-foreground mt-3">Workers</div>
          {workers.map((worker) => (
            <div key={worker.id} className="flex items-center justify-between text-xs ml-2">
              <Link to={`/agents/${worker.id}`} className="text-foreground hover:underline">
                {worker.name}
              </Link>
              <span className="text-muted-foreground text-xs">
                {taskCountByAgent.get(worker.id) ?? 0} open
              </span>
            </div>
          ))}
        </>
      )}
      {reviewer && (
        <div className="flex items-center justify-between text-xs mt-3">
          <Link to={`/agents/${reviewer.id}`} className="text-foreground hover:underline">
            {reviewer.name}
          </Link>
          <span className="text-muted-foreground text-xs">Reviewer</span>
        </div>
      )}
    </PropertySection>
  );
}
