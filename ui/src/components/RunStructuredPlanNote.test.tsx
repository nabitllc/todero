// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStructuredPlanNote } from "./RunStructuredPlanNote";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: ReactNode) {
  act(() => {
    root.render(ui);
  });
}

describe("which path produced a run's plan, on the run", () => {
  it("tells a person the shape came back and did not hold", () => {
    render(<RunStructuredPlanNote resultJson={{ toderoStructuredPlan: "unreadable", summary: "Here is the plan." }} />);

    const note = container.querySelector("[data-testid='run-structured-plan-path']");
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("Plan: shape did not hold");
    expect(note!.textContent).toContain("never the JSON");
  });

  it("tells a person the runtime held the shape", () => {
    render(<RunStructuredPlanNote resultJson={{ toderoStructuredPlan: "held" }} />);

    expect(container.textContent).toContain("Plan: shape held");
  });

  it("says nothing on a run that was never asked for the shape", () => {
    render(<RunStructuredPlanNote resultJson={{ summary: "Here is the plan." }} />);

    expect(container.querySelector("[data-testid='run-structured-plan-path']")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
