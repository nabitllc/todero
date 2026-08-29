/**
 * Development shim for the package-local runner runtime.
 *
 * Source-mode server entry points do not build workspace dependencies first,
 * so this shim loads the package source through the TypeScript runtime. The
 * server build replaces the emitted shim with the package's compiled `dist`
 * tree so published server packages have no workspace runtime dependency.
 * Keep server imports pointed at this relative boundary.
 */
type RunnerModule = typeof import("@todero/paperclip-runner");

export type {
  ToderoJsonValue,
  ToderoQuestionResponse,
  ToderoSemanticActionBinding,
  ToderoSemanticActionId,
  ToderoSemanticAuthorizationRecord,
  ToderoSemanticRunContext,
  ToderoSemanticToolCall,
  ToderoSemanticToolDefinition,
  ToderoSemanticToolResult,
  PrpEvent,
  PrpStructuredRunResult,
  PrpTerminalState,
} from "@todero/paperclip-runner";
export type DurablePrpControlPlane =
  import("@todero/paperclip-runner").DurablePrpControlPlane;
export type ToderoSemanticDispatcher =
  import("@todero/paperclip-runner").ToderoSemanticDispatcher;

const sourceUrl = new URL(
  "../../../../packages/paperclip-runner/src/index.ts",
  import.meta.url,
);
const runner = await import(sourceUrl.href) as RunnerModule;

export const DurablePrpControlPlane = runner.DurablePrpControlPlane;
export const ToderoSemanticDispatcher = runner.ToderoSemanticDispatcher;
export const validatePrpEvent = runner.validatePrpEvent;
export const validatePrpStructuredRunResult =
  runner.validatePrpStructuredRunResult;
