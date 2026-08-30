// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockVaultApi = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/api/vault", () => ({ toderoVaultApi: mockVaultApi }));

import { SecondBrainPicker } from "./SecondBrainPicker";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SecondBrainPicker", () => {
  beforeEach(() => {
    mockVaultApi.get.mockReset();
    mockVaultApi.save.mockReset();
    mockVaultApi.get.mockResolvedValue({
      settings: null,
      recommendedPath: "C:\\Development\\Todero Brain",
      recommendedExists: false,
      recommendedFromEnv: false,
      readPath: null,
      readPathExists: false,
      readOnly: true,
    });
    mockVaultApi.save.mockResolvedValue({
      settings: { id: 1, source: "none", path: null, updatedAt: new Date().toISOString() },
      readPath: null,
      readPathExists: false,
      readOnly: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows None and Back, and does not treat a missing recommended folder as attached", async () => {
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SecondBrainPicker mode="onboarding" onSaved={onSaved} onBack={onBack} />);
    });
    await flushReact();

    expect(document.body.textContent).toContain("None");
    expect(document.body.textContent).not.toContain("Skip");
    expect(document.body.textContent).toContain("Back");
    expect(document.body.textContent).toMatch(/missing/i);
    expect(document.body.textContent).not.toContain("still allowed");

    const continueBtn = [...document.body.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").trim().startsWith("Continue"),
    );
    expect(continueBtn?.disabled).toBe(true);

    const backBtn = [...document.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Back");
    expect(backBtn).toBeTruthy();
    await act(async () => {
      backBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    const noneCard = [...document.body.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("No Second Brain attached"),
    );
    expect(noneCard).toBeTruthy();
    await act(async () => {
      noneCard!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();
    const continueAfter = [...document.body.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").trim().startsWith("Continue"),
    );
    expect(continueAfter?.disabled).toBe(false);
    await act(async () => {
      continueAfter!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();
    expect(mockVaultApi.save).toHaveBeenCalledWith({ source: "none", path: null });

    await act(async () => root.unmount());
  });
});
