// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockVaultApi = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  ensureRecommended: vi.fn(),
}));

vi.mock("@/api/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/vault")>();
  return { ...actual, toderoVaultApi: mockVaultApi };
});

import { RECOMMENDED_VAULT_REPO_PAGE_URL } from "@/api/vault";
import { SecondBrainPicker } from "./SecondBrainPicker";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function flushUntil(predicate: () => boolean, tries = 12) {
  for (let i = 0; i < tries; i++) {
    await flushReact();
    if (predicate()) return;
  }
}

function continueButton() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").trim().startsWith("Continue"),
  );
}

function footerButtons() {
  return [...document.body.querySelectorAll("button")].filter((b) => {
    const t = (b.textContent ?? "").replace(/\s+/g, " ").trim();
    return t === "Back" || t === "Continue" || t === "None" || t === "Skip" || t === "Save";
  });
}

describe("SecondBrainPicker", () => {
  beforeEach(() => {
    mockVaultApi.get.mockReset();
    mockVaultApi.save.mockReset();
    mockVaultApi.ensureRecommended.mockReset();
    mockVaultApi.get.mockResolvedValue({
      settings: null,
      recommendedPath: "/home/user/.todero/todero-brain",
      recommendedRepoUrl: RECOMMENDED_VAULT_REPO_PAGE_URL,
      recommendedExists: false,
      recommendedFromEnv: false,
      readPath: null,
      readPathExists: false,
      readOnly: true,
    });
    mockVaultApi.ensureRecommended.mockRejectedValue(
      new Error("Failed to clone Recommended Second Brain: fatal: repository not found"),
    );
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

  it("shows None CARD and Back, no footer None, and does not treat a missing recommended folder as attached", async () => {
    const onSaved = vi.fn();
    const onBack = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SecondBrainPicker mode="onboarding" onSaved={onSaved} onBack={onBack} />);
    });
    await flushUntil(() => Boolean(continueButton()) && /missing|not attached|repository not found/i.test(document.body.textContent ?? ""));

    expect(document.body.textContent).toContain("None");
    expect(document.body.textContent).toContain("No Second Brain attached");
    expect(document.body.textContent).not.toContain("Skip");
    expect(document.body.textContent).toContain("Back");
    expect(document.body.textContent).toMatch(/missing|not attached|repository not found/i);
    expect(document.body.textContent).not.toContain("still allowed");
    expect([...document.body.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === "None")).toBe(false);

    const continueBtn = continueButton();
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
    const continueAfter = continueButton();
    expect(continueAfter?.disabled).toBe(false);
    await act(async () => {
      continueAfter!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();
    expect(mockVaultApi.save).toHaveBeenCalledWith({ source: "none", path: null });

    await act(async () => root.unmount());
  });

  it("keeps Continue off and shows the git error when Recommended clone fails", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SecondBrainPicker mode="onboarding" />);
    });
    await flushUntil(() => /repository not found/i.test(document.body.textContent ?? ""));

    expect(document.body.textContent).toMatch(/Failed to clone Recommended Second Brain|repository not found/i);
    expect(document.body.textContent).toMatch(/not attached/i);
    const continueBtn = continueButton();
    expect(continueBtn).toBeTruthy();
    expect(continueBtn?.disabled).toBe(true);
    expect(mockVaultApi.save).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("labels Recommended with the public GitHub repo, not a magic Windows path", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SecondBrainPicker mode="onboarding" />);
    });
    await flushUntil(() => Boolean(continueButton()));

    expect(document.body.textContent).toContain("https://github.com/nabitllc/todero-brain");
    expect(document.body.textContent).not.toContain("C:\\Development\\Todero Brain");
    expect(document.body.textContent).not.toContain("C:/Development/Todero Brain");

    await act(async () => root.unmount());
  });

  it("shows a Personal path field labeled Folder on this computer, and no extra footer None next to Continue", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SecondBrainPicker mode="onboarding" onBack={() => undefined} />);
    });
    await flushUntil(() => Boolean(continueButton()));

    expect(footerButtons().filter((b) => (b.textContent ?? "").trim() === "None")).toHaveLength(0);
    expect(continueButton()).toBeTruthy();
    expect([...document.body.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === "Back")).toBe(true);

    const personalCard = [...document.body.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Folder on this computer."),
    );
    expect(personalCard).toBeTruthy();
    await act(async () => {
      personalCard!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("Folder on this computer.");
    const pathField = document.body.querySelector("#todero-personal-vault-path") as HTMLInputElement | null;
    expect(pathField).toBeTruthy();
    expect(pathField?.getAttribute("aria-label")).toMatch(/folder path/i);
    expect(document.body.querySelector('input[type="file"][aria-label="Browse for a folder on this computer"]')).toBeTruthy();
    expect(continueButton()?.disabled).toBe(true);

    await act(async () => root.unmount());
  });
});
