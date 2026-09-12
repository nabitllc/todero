/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockResetToOriginal } = vi.hoisted(() => ({
  mockResetToOriginal: vi.fn(),
}));

vi.mock("../../api/companySkills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/companySkills")>();
  return {
    ...actual,
    companySkillsApi: {
      ...actual.companySkillsApi,
      resetToOriginal: mockResetToOriginal,
    },
  };
});

import { SkillPackRowMeta } from "./SkillPackRowMeta";

const item = {
  id: "s1",
  companyId: "c1",
  key: "company/c1/todero-plan-a-project",
  slug: "todero-plan-a-project",
  name: "todero-plan-a-project",
  description: null,
  sourceType: "catalog" as const,
  sourceLocator: null,
  sourceRef: null,
  trustLevel: "markdown_only" as const,
  compatibility: "compatible" as const,
  fileInventory: [],
  iconUrl: null,
  color: null,
  tagline: null,
  authorName: null,
  homepageUrl: null,
  categories: [],
  sharingScope: "private" as const,
  publicShareToken: null,
  forkedFromSkillId: null,
  forkedFromCompanyId: null,
  starCount: 0,
  installCount: 0,
  forkCount: 0,
  currentVersionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  metadata: { version: 1, last_changed_because: "Shipped with the skill pack.", "todero-task-kinds": "[planning]", "todero-priority": 1 },
};

describe("SkillPackRowMeta", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
    mockResetToOriginal.mockClear();
    vi.clearAllMocks();
  });

  it("renders version and because-line and a reset button", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SkillPackRowMeta item={item} companyId="c1" />);
    });

    expect(container.textContent).toContain("Version 1");
    expect(container.textContent).toContain("Last changed because: Shipped with the skill pack.");
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().includes("Reset to the original"),
    );
    expect(button).toBeTruthy();

    // Test button click
    mockResetToOriginal.mockResolvedValue({ ok: true });
    await act(async () => {
      button!.click();
    });

    expect(mockResetToOriginal).toHaveBeenCalledWith("c1", "s1");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders nothing for non-pack skills", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const nonPackItem = { ...item, metadata: null };

    await act(async () => {
      root.render(<SkillPackRowMeta item={nonPackItem} companyId="c1" />);
    });

    expect(container.textContent).toBe("");

    await act(async () => {
      root.unmount();
    });
  });

  it("calls onReset callback after successful reset", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onReset = vi.fn();

    mockResetToOriginal.mockResolvedValue({ ok: true });

    await act(async () => {
      root.render(<SkillPackRowMeta item={item} companyId="c1" onReset={onReset} />);
    });

    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().includes("Reset to the original"),
    );

    await act(async () => {
      button!.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onReset).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("shows error message on reset failure", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    mockResetToOriginal.mockRejectedValue(new Error("API error"));

    await act(async () => {
      root.render(<SkillPackRowMeta item={item} companyId="c1" />);
    });

    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().includes("Reset to the original"),
    );

    await act(async () => {
      button!.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Could not reset this skill.");

    await act(async () => {
      root.unmount();
    });
  });
});
