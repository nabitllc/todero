import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceGeneralSettings,
  InstanceSettings,
  IssueGraphLivenessAutoRecoveryPreview,
  PatchInstanceSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
} from "@todero/shared";
import { api } from "./client";

/** What the instance-wide Pause / Play switch reports back. */
export interface InstancePauseResult {
  paused?: number;
  resumed?: number;
  companyIds: string[];
}

export const instanceSettingsApi = {
  /** Pause every organization that is running right now. */
  pauseAll: () => api.post<InstancePauseResult>("/instance/pause-all", {}),
  /** Master Pause: whether the sidebar's Pause is on, and since when. */
  pauseState: () => api.get<{ paused: boolean; pausedAt: string | null; companyIds: string[] }>("/instance/pause"),
  /**
   * Put back only what this switch stopped. An organization the person paused
   * by hand keeps its own pause.
   */
  resumeAll: () => api.post<InstancePauseResult>("/instance/resume-all", {}),
  get: () =>
    api.get<InstanceSettings>("/instance/settings"),
  update: (patch: PatchInstanceSettings) =>
    api.patch<InstanceSettings>("/instance/settings", patch),
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getExperimental: () =>
    api.get<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental", patch),
  previewIssueGraphLivenessAutoRecovery: (input: { lookbackHours?: number }) =>
    api.post<IssueGraphLivenessAutoRecoveryPreview>(
      "/instance/settings/experimental/issue-graph-liveness-auto-recovery/preview",
      input,
    ),
  runIssueGraphLivenessAutoRecovery: (input: { lookbackHours?: number }) =>
    api.post<{
      findings: number;
      autoRecoveryEnabled: boolean;
      lookbackHours: number;
      cutoff: string;
      escalationsCreated: number;
      existingEscalations: number;
      skipped: number;
      skippedAutoRecoveryDisabled: number;
      skippedOutsideLookback: number;
      dependencyWakeBackstopChecked: number;
      dependencyWakesHealed: number;
      dependencyWakeExistingSkipped: number;
      dependencyWakeLivePathSkipped: number;
      dependencyWakeInteractionSkipped: number;
      dependencyWakePauseHoldSkipped: number;
      dependencyWakeNotReadySkipped: number;
      dependencyWakeCandidateLimitSkipped: number;
      dependencyWakeDeferredOrFailed: number;
      dependencyWakeEnqueueFailed: number;
      dependencyWakeIssueIds: string[];
      escalationIssueIds: string[];
    }>(
      "/instance/settings/experimental/issue-graph-liveness-auto-recovery/run",
      input,
    ),
};
