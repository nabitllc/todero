import type {
  CompanyStatus,
  IssueThreadInteractionKind,
  IssueThreadInteractionResolverPolicy,
  PauseReason,
} from "../constants.js";

export interface InteractionResolverKindGovernance {
  defaultPolicy?: IssueThreadInteractionResolverPolicy;
  cap?: IssueThreadInteractionResolverPolicy;
}

export type InteractionResolverGovernance = Partial<
  Record<IssueThreadInteractionKind, InteractionResolverKindGovernance>
> & {
  /**
   * The zero-human switch. Off unless it is turned on: a task the reviewer
   * passes waits in "Waiting on you" for the person to accept it. Turned on,
   * the reviewer's pass closes the task and starts the next one. Lives here
   * rather than in a column of its own because this JSON is already the
   * company's "who decides what" settings blob.
   */
  autoAcceptWhenJudgePasses?: boolean;
  /**
   * The list of available models on the local LLM runtime this company uses,
   * populated when the connection test passes at onboarding.
   */
  toderoLocalLlmAvailableModelIds?: string[];
};

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  defaultResponsibleUserId: string | null;
  requireBoardApprovalForNewAgents: boolean;
  interactionResolverGovernance: InteractionResolverGovernance;
  feedbackDataSharingEnabled: boolean;
  feedbackDataSharingConsentAt: Date | null;
  feedbackDataSharingConsentByUserId: string | null;
  feedbackDataSharingTermsVersion: string | null;
  logoAssetId: string | null;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
