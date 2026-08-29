import type {
  ToderoJsonSchema,
  ToderoJsonValue,
  ToderoSemanticActionDescriptor,
  ToderoSemanticActionEffect,
  ToderoSemanticActionId,
  ToderoSemanticActionMode,
} from "../catalog/semantic-action-types.js";
import type { PrpSemanticToolEnvelope } from "../protocol/replay-contract.js";

export interface ToderoSemanticRunContext {
  readonly runId: string;
  readonly companyId: string;
  readonly actor: {
    readonly id: string;
    readonly companyId: string;
    readonly status: string;
    readonly role: string;
    readonly claims: readonly string[];
  };
  readonly activeTask: {
    readonly id: string;
    readonly companyId: string;
    readonly assigneeActorId: string | null;
    readonly executionRunId: string | null;
    readonly status: string;
    readonly workMode: ToderoSemanticActionMode;
  };
  /** Claims explicitly delegated to this run. Actor claims can only narrow them. */
  readonly delegatedClaims: readonly string[];
  readonly policy?: {
    readonly deniedOperationIds?: readonly ToderoSemanticActionId[];
    readonly allowedInteractionKinds?: readonly string[];
  };
}

export type ToderoSemanticContextProvider = (
  runId: string,
) => ToderoSemanticRunContext | Promise<ToderoSemanticRunContext>;

export interface ToderoSemanticToolDefinition {
  readonly name: ToderoSemanticActionId;
  readonly description: string;
  readonly inputSchema: ToderoJsonSchema;
  readonly outputSchema: ToderoJsonSchema;
  readonly annotations: {
    readonly semanticContract: "todero.semantic-action.v1";
    readonly version: 1;
    readonly placement: ToderoSemanticActionDescriptor["placement"];
    readonly effect: ToderoSemanticActionEffect;
    readonly requiredClaims: readonly string[];
  };
}

export interface ToderoSemanticDiscoveryResult {
  readonly schema: "todero.semantic-discovery.v1";
  readonly query: string;
  readonly namespace: string | null;
  readonly operations: readonly ToderoSemanticToolDefinition[];
  readonly truncated: boolean;
}

export type ToderoSemanticAuthorizationPhase = "exposure" | "invocation";

export type ToderoSemanticDenialCode =
  | "operation_absent"
  | "authority_context_invalid"
  | "run_mismatch"
  | "company_mismatch"
  | "actor_inactive"
  | "task_mode_denied"
  | "task_state_denied"
  | "task_ownership_denied"
  | "required_claim_missing"
  | "actor_role_denied"
  | "policy_denied"
  | "interaction_kind_denied"
  | "protected_data_denied"
  | "input_invalid"
  | "idempotency_required"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "receipt_store_unavailable"
  | "receipt_recovery_failed"
  | "binding_failed"
  | "binding_output_invalid";

export interface ToderoSemanticAuthorizationDecision {
  readonly allowed: boolean;
  readonly phase: ToderoSemanticAuthorizationPhase;
  readonly operationId: ToderoSemanticActionId;
  readonly code: "allowed" | ToderoSemanticDenialCode;
  readonly reason: string;
  readonly effectiveClaims: readonly string[];
}

export interface ToderoSemanticAuthorizationRecord extends ToderoSemanticAuthorizationDecision {
  readonly schema: "todero.semantic-authorization-record.v1";
  readonly id: string;
  readonly runId: string;
  readonly companyId: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly callId: string | null;
  readonly inputDigest: string | null;
  readonly operationReceiptId: string | null;
}

export interface ToderoSemanticSafeReference {
  readonly kind:
    | "task"
    | "document_revision"
    | "interaction"
    | "approval"
    | "decision"
    | "artifact"
    | "work_product"
    | "wake"
    | "monitor"
    | "audit"
    | "operation";
  readonly id: string;
}

export interface ToderoSemanticBindingResult {
  readonly value: ToderoJsonValue;
  readonly code?: string;
  readonly stateRevision?: number;
  readonly references?: readonly ToderoSemanticSafeReference[];
  readonly auditReceiptId?: string;
}

export interface ToderoAuthorizedSemanticInvocation {
  readonly runId: string;
  readonly companyId: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly callId: string;
  readonly operationId: ToderoSemanticActionId;
  readonly input: Readonly<Record<string, ToderoJsonValue>>;
}

export interface ToderoSemanticActionBinding {
  readonly operationId: ToderoSemanticActionId;
  execute(
    invocation: ToderoAuthorizedSemanticInvocation,
  ): ToderoSemanticBindingResult | Promise<ToderoSemanticBindingResult>;
}

export interface ToderoSemanticCorrelation {
  readonly runId: string;
  readonly normalizedSessionId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly requestId?: string;
}

export interface ToderoSemanticToolCall {
  readonly runId: string;
  readonly callId: string;
  readonly operationId: string;
  readonly correlation: ToderoSemanticCorrelation;
  readonly input: unknown;
}

export interface ToderoSemanticStoredOutcome {
  readonly operationId: ToderoSemanticActionId;
  readonly inputDigest: string;
  readonly operationReceiptId: string;
  readonly value: ToderoJsonValue;
  readonly code: string;
  readonly stateRevision?: number;
  readonly references: readonly ToderoSemanticSafeReference[];
  readonly auditReceiptId?: string;
}

export type ToderoSemanticIdempotencyClaim =
  | { readonly kind: "claimed"; readonly token: string }
  | {
      readonly kind: "duplicate";
      readonly outcome: ToderoSemanticStoredOutcome;
    }
  | { readonly kind: "conflict" }
  | { readonly kind: "in_progress" };

/**
 * The claim operation must be atomic. Production bindings must persist this
 * store before they expose mutation actions. `complete` is the primary commit
 * path. `recover` is a required, idempotent fallback that must durably resolve
 * a claim to the same outcome when the primary commit reports an ambiguous or
 * transient failure. A store without an independent recovery path cannot be
 * used to expose mutation actions.
 */
export interface ToderoSemanticIdempotencyStore {
  claim(input: {
    readonly scope: string;
    readonly operationId: ToderoSemanticActionId;
    readonly inputDigest: string;
  }):
    | ToderoSemanticIdempotencyClaim
    | Promise<ToderoSemanticIdempotencyClaim>;
  complete(
    token: string,
    outcome: ToderoSemanticStoredOutcome,
  ): void | Promise<void>;
  recover(
    token: string,
    outcome: ToderoSemanticStoredOutcome,
  ): void | Promise<void>;
  release(token: string): void | Promise<void>;
}

export interface ToderoSemanticToolSuccess {
  readonly ok: true;
  readonly operationId: ToderoSemanticActionId;
  readonly callId: string;
  readonly value: ToderoJsonValue;
  readonly code: string;
  readonly duplicate: boolean;
  readonly stateRevision?: number;
  readonly inputReceipt: PrpSemanticToolEnvelope;
  readonly resultReceipt: PrpSemanticToolEnvelope;
}

export interface ToderoSemanticToolDenial {
  readonly ok: false;
  readonly operationId: string;
  readonly callId: string;
  readonly error: {
    readonly code: ToderoSemanticDenialCode;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly inputReceipt: PrpSemanticToolEnvelope | null;
  readonly resultReceipt: PrpSemanticToolEnvelope | null;
}

export type ToderoSemanticToolResult =
  ToderoSemanticToolSuccess | ToderoSemanticToolDenial;
