import { PAPERCLIP_SEMANTIC_ACTION_CATALOG } from "../catalog/semantic-action-catalog.js";
import type {
  ToderoSemanticActionDescriptor,
  ToderoSemanticActionId,
} from "../catalog/semantic-action-types.js";
import { decideToderoSemanticAuthorization } from "./authorization.js";
import type {
  ToderoSemanticDiscoveryResult,
  ToderoSemanticRunContext,
  ToderoSemanticToolDefinition,
} from "./types.js";

const NAMESPACE: Readonly<Record<ToderoSemanticActionId, string>> =
  Object.freeze({
    get_task_context: "active_task",
    get_task_history: "active_task",
    list_documents: "documents",
    read_document: "documents",
    list_document_revisions: "documents",
    report_progress: "active_task",
    answer_status_question: "active_task",
    write_document: "documents",
    request_human_input: "documents",
    register_deliverable: "documents",
    finish_task: "active_task",
    block_task: "active_task",
    request_review: "active_task",
    list_agents: "discovery",
    get_agent: "discovery",
    search_tasks: "discovery",
    list_approvals: "governance",
    get_approval: "governance",
    get_approval_context: "governance",
    get_workspace_runtime: "workspace",
    control_workspace_service: "workspace",
    set_dependencies: "delegation",
    create_task: "delegation",
    request_approval: "governance",
    decide_approval: "governance",
    comment_on_approval: "governance",
    schedule_wake: "continuation",
  });

export function toderoSemanticActionNamespace(
  operationId: ToderoSemanticActionId,
): string {
  return NAMESPACE[operationId];
}

export function projectToderoSemanticTools(input: {
  readonly runId: string;
  readonly context: ToderoSemanticRunContext;
  readonly boundOperationIds: ReadonlySet<ToderoSemanticActionId>;
  readonly placement?: ToderoSemanticActionDescriptor["placement"];
}): readonly ToderoSemanticToolDefinition[] {
  return deepFreeze(authorizedBoundDescriptors(input).map(toToolDefinition));
}

export function discoverToderoSemanticTools(input: {
  readonly runId: string;
  readonly context: ToderoSemanticRunContext;
  readonly boundOperationIds: ReadonlySet<ToderoSemanticActionId>;
  readonly query: string;
  readonly namespace?: string;
  readonly limit?: number;
}): ToderoSemanticDiscoveryResult {
  const normalized = input.query.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 500) {
    throw new Error("semantic_discovery_query_invalid");
  }
  const namespace = input.namespace?.trim().toLowerCase();
  if (namespace !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(namespace)) {
    throw new Error("semantic_discovery_namespace_invalid");
  }
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 5), 8));
  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
  const candidates = authorizedBoundDescriptors({
    ...input,
    placement: "optional",
  })
    .filter(
      (descriptor) =>
        namespace === undefined ||
        toderoSemanticActionNamespace(descriptor.operationId) === namespace,
    )
    .map((descriptor) => ({
      descriptor,
      score: scoreDescriptor(descriptor, normalized, tokens),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.descriptor.operationId.localeCompare(right.descriptor.operationId),
    );

  return deepFreeze({
    schema: "todero.semantic-discovery.v1",
    query: input.query,
    namespace: namespace ?? null,
    operations: candidates
      .slice(0, limit)
      .map(({ descriptor }) => toToolDefinition(descriptor)),
    truncated: candidates.length > limit,
  });
}

export function toToderoSemanticToolDefinition(
  descriptor: ToderoSemanticActionDescriptor,
): ToderoSemanticToolDefinition {
  return deepFreeze(toToolDefinition(descriptor));
}

function authorizedBoundDescriptors(input: {
  readonly runId: string;
  readonly context: ToderoSemanticRunContext;
  readonly boundOperationIds: ReadonlySet<ToderoSemanticActionId>;
  readonly placement?: ToderoSemanticActionDescriptor["placement"];
}): ToderoSemanticActionDescriptor[] {
  return PAPERCLIP_SEMANTIC_ACTION_CATALOG.filter(
    (descriptor) =>
      input.boundOperationIds.has(descriptor.operationId) &&
      (input.placement === undefined ||
        descriptor.placement === input.placement) &&
      decideToderoSemanticAuthorization(
        descriptor,
        input.context,
        "exposure",
        input.runId,
      ).allowed,
  );
}

function scoreDescriptor(
  descriptor: ToderoSemanticActionDescriptor,
  query: string,
  tokens: readonly string[],
): number {
  const operationId = descriptor.operationId.toLowerCase();
  const namespace = toderoSemanticActionNamespace(descriptor.operationId);
  const haystack =
    `${operationId} ${descriptor.title} ${descriptor.description} ${namespace}`.toLowerCase();
  let score = operationId === query ? 100 : namespace === query ? 50 : 0;
  for (const token of tokens) {
    if (operationId.includes(token)) score += 12;
    if (namespace.includes(token)) score += 8;
    if (haystack.includes(token)) score += 3;
  }
  return score;
}

function toToolDefinition(
  descriptor: ToderoSemanticActionDescriptor,
): ToderoSemanticToolDefinition {
  return {
    name: descriptor.operationId,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    outputSchema: descriptor.outputSchema,
    annotations: {
      semanticContract: descriptor.schema,
      version: descriptor.version,
      placement: descriptor.placement,
      effect: descriptor.effect,
      requiredClaims: descriptor.requiredClaims,
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
