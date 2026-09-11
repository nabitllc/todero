import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import type { Company } from "@todero/shared";
import { companiesApi } from "@/api/companies";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { useNavigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useCompany } from "../../context/CompanyContext";
import { Button } from "../ui/button";

/** The organization is stopped: nothing new starts until the person presses Play. */
export function isCompanyPaused(company: Pick<Company, "status"> | null | undefined): boolean {
  return company?.status === "paused";
}

/** One control, two readings. Nothing else on the button changes. */
export function pauseButtonLabel(company: Pick<Company, "status"> | null | undefined): "Pause" | "Play" {
  return isCompanyPaused(company) ? "Play" : "Pause";
}

/** The clock a person recognizes: 10:42, in their own time zone. */
export function formatPausedSinceTime(pausedAt: Date | string | null | undefined): string | null {
  if (!pausedAt) return null;
  const date = pausedAt instanceof Date ? pausedAt : new Date(pausedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * The line under the button. While the organization is running it says so;
 * while it is paused it says since when, and falls back to the plain word when
 * the timestamp is missing or unreadable.
 */
export function pauseCaption(
  company: Pick<Company, "status" | "pausedAt"> | null | undefined,
): string {
  if (!isCompanyPaused(company)) return "Agents are working";
  const time = formatPausedSinceTime(company?.pausedAt ?? null);
  return time ? `Paused since ${time}` : "Paused";
}

/**
 * Play / Pause for the organization you are looking at, right under its name.
 *
 * Pressing Pause asks nothing: it stops the organization and opens the Inbox,
 * where the Paused card explains what was stopped and what is waiting. Pressing
 * Play puts it back and leaves you where you are.
 */
export function PauseControl({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedCompany: company } = useCompany();
  const paused = isCompanyPaused(company);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });

  const toggle = useMutation({
    mutationFn: async () => {
      if (!company) return null;
      return paused ? companiesApi.resume(company.id) : companiesApi.pause(company.id);
    },
    onSuccess: () => {
      void refresh();
      // Pause opens the Inbox: that is where the Paused card lives, and the
      // first thing a person wants after stopping everything is to see what
      // was stopped.
      if (!paused) navigate("/inbox");
    },
  });

  if (!company) return null;
  const label = pauseButtonLabel(company);

  return (
    <div className={cn("flex items-center gap-2 px-3 pb-2", className)} data-testid="pause-control">
      <Button
        size="sm"
        variant={paused ? "default" : "outline"}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
        data-testid="pause-control-button"
        aria-label={label}
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {label}
      </Button>
      <span className="truncate text-xs text-muted-foreground" data-testid="pause-control-caption">
        {pauseCaption(company)}
      </span>
    </div>
  );
}

/**
 * The instance-wide switch, in the sidebar footer. "Pause everything" stops
 * every organization that is running; "Resume everything" puts back only the
 * ones this switch stopped, so an organization paused by hand stays paused.
 */
export function PauseEverythingControl({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });

  const pauseAll = useMutation({ mutationFn: () => instanceSettingsApi.pauseAll(), onSuccess: refresh });
  const resumeAll = useMutation({ mutationFn: () => instanceSettingsApi.resumeAll(), onSuccess: refresh });
  const busy = pauseAll.isPending || resumeAll.isPending;

  return (
    <div className={cn("flex items-center gap-2 px-3 py-2", className)} data-testid="pause-everything">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => pauseAll.mutate()}
        data-testid="pause-everything-pause"
      >
        <Pause className="h-3.5 w-3.5" />
        Pause everything
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => resumeAll.mutate()}
        data-testid="pause-everything-resume"
      >
        <Play className="h-3.5 w-3.5" />
        Resume everything
      </Button>
    </div>
  );
}
