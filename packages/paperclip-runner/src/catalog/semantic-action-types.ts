export type ToderoSemanticActionId =
  | "get_task_context"
  | "get_task_history"
  | "list_documents"
  | "read_document"
  | "list_document_revisions"
  | "report_progress"
  | "answer_status_question"
  | "write_document"
  | "request_human_input"
  | "register_deliverable"
  | "finish_task"
  | "block_task"
  | "request_review"
  | "list_agents"
  | "get_agent"
  | "search_tasks"
  | "list_approvals"
  | "get_approval"
  | "get_approval_context"
  | "get_workspace_runtime"
  | "control_workspace_service"
  | "set_dependencies"
  | "create_task"
  | "request_approval"
  | "decide_approval"
  | "comment_on_approval"
  | "schedule_wake";

export type ToderoSemanticActionPlacement = "always" | "optional";
export type ToderoSemanticActionMode =
  "standard" | "ask" | "planning" | "skill_test";
export type ToderoSemanticActionEffect = "read" | "write" | "governance";

export type ToderoJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ToderoJsonValue[]
  | { readonly [key: string]: ToderoJsonValue };

/** The JSON Schema subset used by the v1 semantic action catalog. */
export interface ToderoJsonSchema {
  readonly type?: string | readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, ToderoJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | ToderoJsonSchema;
  readonly items?: ToderoJsonSchema;
  readonly enum?: readonly ToderoJsonValue[];
  readonly oneOf?: readonly ToderoJsonSchema[];
  readonly anyOf?: readonly ToderoJsonSchema[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly pattern?: string;
  readonly format?: string;
  readonly default?: ToderoJsonValue;
}

/**
 * A transport-neutral declaration. Catalog membership never grants discovery
 * or invocation authority; a run-scoped authorization layer must do that.
 */
export interface ToderoSemanticActionDescriptor {
  readonly schema: "todero.semantic-action.v1";
  readonly operationId: ToderoSemanticActionId;
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly placement: ToderoSemanticActionPlacement;
  readonly effect: ToderoSemanticActionEffect;
  readonly requiredClaims: readonly string[];
  readonly allowedModes: readonly ToderoSemanticActionMode[];
  readonly allowedRoles?: readonly string[];
  readonly inputSchema: ToderoJsonSchema;
  readonly outputSchema: ToderoJsonSchema;
}
