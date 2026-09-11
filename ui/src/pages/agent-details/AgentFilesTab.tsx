import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import type { AgentDetail as AgentDetailRecord } from "@todero/shared";
import { agentsApi } from "../../api/agents";
import { queryKeys } from "../../lib/queryKeys";
import { EmptyState } from "../../components/EmptyState";

interface AgentFilesTabProps {
  agent: Pick<AgentDetailRecord, "id" | "name">;
  companyId: string | undefined;
}

/** A file name, with the leading date and the .md ending taken off. */
function readableDocumentName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.md$/i, "");
  const dated = /^(\d{4}-\d{2}-\d{2})-(.*)$/.exec(withoutExtension);
  if (!dated) return withoutExtension;
  return `${dated[2]} — ${dated[1]}`;
}

function FileList({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((item) => (
          <li key={item} className="px-3 py-2 text-sm text-foreground">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What this agent keeps beside its instructions: its brief, a copy of
 * everything turned on for it, and everything it has handed in.
 */
export function AgentFilesTab({ agent, companyId }: AgentFilesTabProps) {
  const { data: folder, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.agents.folder(companyId ?? "none", agent.id),
    queryFn: () => agentsApi.folder(companyId!, agent.id),
    enabled: Boolean(companyId),
  });

  if (!companyId || isLoading) {
    return (
      <p className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
        Loading this agent's files…
      </p>
    );
  }

  // An empty folder and a folder we could not read look the same from here,
  // and they mean opposite things to the person: one is a new agent, the other
  // is something to try again.
  if (isError) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-4">
        <p className="text-sm text-foreground">Could not read this agent's files.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const hasAnything = Boolean(folder?.brief) || (folder?.skills.length ?? 0) > 0 || (folder?.documents.length ?? 0) > 0;
  if (!folder || !hasAnything) {
    return (
      <EmptyState
        icon={FileText}
        message="Nothing here yet"
        description={`${agent.name} gets a brief and a copy of everything turned on for it the first time it picks up work. Anything it hands in lands here too.`}
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {folder.brief ? (
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-medium text-foreground">The brief</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Who this agent is and what it reads first.</p>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-foreground">
            {folder.brief}
          </pre>
        </section>
      ) : null}

      {folder.skills.length > 0 ? (
        <FileList
          title="What your agent knows"
          description="A copy of each one it has turned on. Edit them on the Skills page."
          items={folder.skills.map((name) => name.replace(/\.md$/i, ""))}
        />
      ) : null}

      {folder.documents.length > 0 ? (
        <FileList
          title="What it has produced"
          description="Every hand-in, kept with the date and the task it was for."
          items={folder.documents.map(readableDocumentName)}
        />
      ) : null}
    </div>
  );
}
