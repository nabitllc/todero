// Gauntlet item 1: the row's meta line and the wired "Reset to the original".
// Fails until ui/src/components/skills/SkillPackRowMeta.tsx exists and calls
// companySkillsApi.resetToOriginal.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockResetToOriginal = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("../../api/companySkills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/companySkills")>();
  return { ...actual, companySkillsApi: { ...actual.companySkillsApi, resetToOriginal: mockResetToOriginal } };
});

import { SkillPackRowMeta } from "./SkillPackRowMeta";

const item = {
  id: "s1",
  companyId: "c1",
  key: "company/c1/todero-plan-a-project",
  name: "todero-plan-a-project",
  metadata: { version: 1, last_changed_because: "Shipped with the skill pack.", "todero-task-kinds": "[planning]", "todero-priority": 1 },
};

describe("SkillPackRowMeta", () => {
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    container?.remove();
    container = null;
    mockResetToOriginal.mockClear();
  });

  it("shows the version and the because-line, and resets through the API", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SkillPackRowMeta item={item as never} companyId="c1" />);
    });
    expect(container.textContent).toContain("Version 1");
    expect(container.textContent).toContain("Last changed because: Shipped with the skill pack.");
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reset to the original");
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(mockResetToOriginal).toHaveBeenCalledWith("c1", "s1");
    await act(async () => {
      root.unmount();
    });
  });
});
