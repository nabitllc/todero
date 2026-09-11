import type { Agent } from "@todero/shared";
import { Button } from "@/components/ui/button";
import { Rows3, Users, Check, Minimize2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { BoardPrefs } from "../../lib/board-prefs";

/** The four choices the board remembers per organization. */
export function BoardToolbar({
  prefs,
  agents,
  onChange,
}: {
  prefs: BoardPrefs;
  agents: Array<Pick<Agent, "id" | "name">>;
  onChange: (patch: Partial<BoardPrefs>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="board-toolbar">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={prefs.rowsBy === "feature"}
        className={cn(prefs.rowsBy === "feature" && "bg-accent")}
        onClick={() => onChange({ rowsBy: prefs.rowsBy === "feature" ? "agent" : "feature" })}
      >
        {prefs.rowsBy === "feature" ? <Rows3 className="size-3.5" /> : <Users className="size-3.5" />}
        {prefs.rowsBy === "feature" ? "Rows by feature" : "Rows by agent"}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={prefs.showCompleted}
        className={cn(prefs.showCompleted && "bg-accent")}
        onClick={() => onChange({ showCompleted: !prefs.showCompleted })}
      >
        <Check className="size-3.5" />
        Completed features
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={prefs.compactCards}
        className={cn(prefs.compactCards && "bg-accent")}
        onClick={() => onChange({ compactCards: !prefs.compactCards })}
      >
        <Minimize2 className="size-3.5" />
        Compact cards
      </Button>

      <label className="ml-1 flex items-center gap-1 text-(length:--text-nano) text-muted-foreground">
        <span className="sr-only">Show one agent only</span>
        <select
          value={prefs.agentFilter ?? ""}
          onChange={(event) => onChange({ agentFilter: event.target.value || null })}
          aria-label="Show one agent only"
          className="rounded-md border border-border bg-background px-1.5 py-1 text-(length:--text-nano) text-foreground"
        >
          <option value="">Everyone</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
