import type { IssueCostSummary } from "@todero/shared";
import { closedValue, formatTokenCost, formatTokenUsage } from "../work-item/work-item-model";

/**
 * The Cost and time group's read-only values. An empty field reads "None"
 * rather than a dash — the panel never shows a placeholder a person could
 * mistake for a value.
 */
export const PANEL_EMPTY_VALUE = "None";

function orNone(value: string): string {
  return value === "—" ? PANEL_EMPTY_VALUE : value;
}

/** Tokens spent on this task and everything under it. */
export function panelTokenUsageLabel(summary: Pick<
  IssueCostSummary,
  "inputTokens" | "outputTokens" | "cachedInputTokens"
> | null | undefined): string {
  return orNone(formatTokenUsage(summary));
}

/** What those tokens cost, in dollars. */
export function panelTokenCostLabel(costCents: number | null | undefined): string {
  return orNone(formatTokenCost(costCents));
}

/**
 * When the task closed — done or cancelled, whichever happened. Null while it
 * is still open, so the row can say None.
 */
export function panelClosedAt(issue: {
  status?: string;
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
}): Date | string | null {
  return closedValue(issue);
}
