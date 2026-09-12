import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** What the sidebar's own switch reads: the instance, not one organization. */
export type InstancePauseState = { paused: boolean; pausedAt: string | null };

/** The sidebar's line: everything running, or everything paused since when. */
export function instancePauseCaption(state: InstancePauseState | null | undefined): string {
  if (!state?.paused) return "Agents are working";
  const time = formatPausedSinceTime(state.pausedAt);
  return time ? `Everything paused since ${time}` : "Everything paused";
}

export const INSTANCE_PAUSE_QUERY_KEY = ["instance", "pause"] as const;

/**
 * The one Play / Pause in the sidebar, for everything on this instance.
 *
 * Pause means no organization talks to a model until Play: turns already
 * under way finish, everything queued waits, routines skip their due firings
 * and the clean-up sweeps leave every task alone. Pressing Pause opens the
 * Inbox, where the Paused card explains what was stopped and what is waiting.
 * Play puts it all back and leaves you where you are.
 */
export function PauseControl({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedCompany: company } = useCompany();
  const state = useQuery({
    queryKey: INSTANCE_PAUSE_QUERY_KEY,
    queryFn: () => instanceSettingsApi.pauseState(),
    refetchInterval: 15_000,
  });
  const paused = state.data?.paused === true;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: INSTANCE_PAUSE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
    ]);
  };

  const toggle = useMutation({
    mutationFn: async () => (paused ? instanceSettingsApi.resumeAll() : instanceSettingsApi.pauseAll()),
    onSuccess: async () => {
      await refresh();
      if (!paused) navigate("/inbox");
    },
  });

  const label = paused ? "Play" : "Pause";

  return (
    <div className={cn("flex items-center gap-2 px-3 pb-2", className)} data-testid="pause-control">
      <Button
        size="sm"
        variant={paused ? "default" : "outline"}
        disabled={toggle.isPending || state.isLoading}
        onClick={() => toggle.mutate()}
        data-testid="pause-control-button"
        aria-label={label}
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {label}
      </Button>
      <span className="truncate text-xs text-muted-foreground" data-testid="pause-control-caption">
        {!state.data?.paused && isCompanyPaused(company)
          ? "This organization is paused on its own; Play is in Settings."
          : instancePauseCaption(state.data)}
      </span>
    </div>
  );
}

/**
 * Play / Pause for one organization, on its Settings page. The sidebar's
 * switch covers everything; this is for the rare case of holding one
 * organization while the others keep working. An organization paused here
 * stays paused when the sidebar's Play is pressed.
 */
export function OrganizationPauseControl({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const { selectedCompany: company } = useCompany();
  const paused = isCompanyPaused(company);

  const toggle = useMutation({
    mutationFn: async () => {
      if (!company) return null;
      return paused ? companiesApi.resume(company.id) : companiesApi.pause(company.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({ queryKey: INSTANCE_PAUSE_QUERY_KEY });
    },
  });

  if (!company) return null;
  const label = pauseButtonLabel(company);

  return (
    <div className={cn("flex items-center gap-2", className)} data-testid="organization-pause-control">
      <Button
        size="sm"
        variant={paused ? "default" : "outline"}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
        data-testid="organization-pause-control-button"
        aria-label={label}
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {label}
      </Button>
      <span className="truncate text-xs text-muted-foreground" data-testid="organization-pause-control-caption">
        {pauseCaption(company)}
      </span>
    </div>
  );
}
