import { describe, expect, it } from "vitest";
import { PANEL_EMPTY_VALUE, panelClosedAt, panelTokenCostLabel, panelTokenUsageLabel } from "./panel-cost";

describe("token usage in the panel", () => {
  it("says None rather than a dash when nothing was spent", () => {
    expect(panelTokenUsageLabel(null)).toBe(PANEL_EMPTY_VALUE);
    expect(panelTokenUsageLabel(undefined)).toBe(PANEL_EMPTY_VALUE);
    expect(panelTokenUsageLabel({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 })).toBe(
      PANEL_EMPTY_VALUE,
    );
  });

  it("adds the three counts up and shortens them", () => {
    expect(panelTokenUsageLabel({ inputTokens: 400, outputTokens: 100, cachedInputTokens: 0 })).toBe("500");
    expect(panelTokenUsageLabel({ inputTokens: 1_200, outputTokens: 300, cachedInputTokens: 0 })).toBe("1.5k");
  });
});

describe("token cost in the panel", () => {
  it("says None rather than inventing $0.00", () => {
    expect(panelTokenCostLabel(null)).toBe(PANEL_EMPTY_VALUE);
    expect(panelTokenCostLabel(undefined)).toBe(PANEL_EMPTY_VALUE);
    expect(panelTokenCostLabel(0)).toBe(PANEL_EMPTY_VALUE);
  });

  it("shows real spend in dollars", () => {
    expect(panelTokenCostLabel(1234)).toBe("$12.34");
  });
});

describe("when the task closed", () => {
  it("prefers the completed time, falls back to the cancelled one", () => {
    expect(panelClosedAt({ completedAt: "2026-09-10T12:00:00.000Z" })).toBe("2026-09-10T12:00:00.000Z");
    expect(panelClosedAt({ cancelledAt: "2026-09-09T12:00:00.000Z" })).toBe("2026-09-09T12:00:00.000Z");
    expect(
      panelClosedAt({
        completedAt: "2026-09-10T12:00:00.000Z",
        cancelledAt: "2026-09-09T12:00:00.000Z",
      }),
    ).toBe("2026-09-10T12:00:00.000Z");
  });

  it("is null while the task is still open", () => {
    expect(panelClosedAt({ status: "todo" })).toBeNull();
    expect(panelClosedAt({ completedAt: null, cancelledAt: null })).toBeNull();
  });
});
