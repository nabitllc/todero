import { describe, expect, it } from "vitest";
import {
  applyAgentSkillSnapshot,
  isReadOnlyUnmanagedSkillEntry,
  sameSkillSelection,
  shouldScheduleSkillAutosave,
} from "./agent-skills-state";

describe("sameSkillSelection", () => {
  it("treats selections as order-independent sets", () => {
    expect(sameSkillSelection(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("detects added or removed keys", () => {
    expect(sameSkillSelection(["a", "b"], ["a"])).toBe(false);
    expect(sameSkillSelection(["a"], ["a", "b"])).toBe(false);
  });
});

describe("shouldScheduleSkillAutosave", () => {
  it("does not re-save when the server returns the same set in a different order", () => {
    // Server preserves stale keys but groups them at the end; the draft keeps the
    // user's order. Same set → already saved, no re-fire (would loop otherwise).
    expect(
      shouldScheduleSkillAutosave({
        draft: ["todero", "stale/removed/skill", "ascii-art"],
        lastSaved: ["todero", "ascii-art", "stale/removed/skill"],
        failedDraft: null,
      }),
    ).toBe(false);
  });

  it("does not save when the draft already matches what was saved", () => {
    expect(
      shouldScheduleSkillAutosave({
        draft: ["todero"],
        lastSaved: ["todero"],
        failedDraft: null,
      }),
    ).toBe(false);
  });

  it("saves when the draft diverges from the last saved state", () => {
    expect(
      shouldScheduleSkillAutosave({
        draft: ["todero", "ascii-art"],
        lastSaved: ["todero"],
        failedDraft: null,
      }),
    ).toBe(true);
  });

  it("holds a payload that just failed to prevent a retry storm (PAP-13222)", () => {
    const draft = ["todero", "stale/removed/skill"];
    expect(
      shouldScheduleSkillAutosave({
        draft,
        lastSaved: ["todero"],
        failedDraft: [...draft],
      }),
    ).toBe(false);
  });

  it("resumes saving once the user edits the draft after a failure", () => {
    expect(
      shouldScheduleSkillAutosave({
        draft: ["todero", "ascii-art"],
        lastSaved: ["todero"],
        failedDraft: ["todero", "stale/removed/skill"],
      }),
    ).toBe(true);
  });
});

describe("applyAgentSkillSnapshot", () => {
  it("hydrates the initial snapshot without arming autosave", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: [],
        lastSaved: [],
        hasHydratedSnapshot: false,
      },
      ["todero", "para-memory-files"],
    );

    expect(result).toEqual({
      draft: ["todero", "para-memory-files"],
      lastSaved: ["todero", "para-memory-files"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: true,
    });
  });

  it("keeps unsaved local edits when a fresh snapshot arrives", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: ["todero", "custom-skill"],
        lastSaved: ["todero"],
        hasHydratedSnapshot: true,
      },
      ["todero"],
    );

    expect(result).toEqual({
      draft: ["todero", "custom-skill"],
      lastSaved: ["todero"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: false,
    });
  });

  it("adopts server state after a successful save and skips the follow-up autosave pass", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: ["todero", "custom-skill"],
        lastSaved: ["todero", "custom-skill"],
        hasHydratedSnapshot: true,
      },
      ["todero", "custom-skill"],
    );

    expect(result).toEqual({
      draft: ["todero", "custom-skill"],
      lastSaved: ["todero", "custom-skill"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: true,
    });
  });

  it("treats user-installed entries outside the company library as read-only unmanaged skills", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "crack-python",
      runtimeName: "crack-python",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
    }, new Set(["todero"]))).toBe(true);
  });

  it("keeps company-library entries in the managed section even when the adapter reports an external conflict", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "todero",
      runtimeName: "todero",
      desired: true,
      managed: false,
      state: "external",
      origin: "company_managed",
    }, new Set(["todero"]))).toBe(false);
  });

  it("falls back to legacy snapshots that only mark unmanaged external entries", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "legacy-external",
      runtimeName: "legacy-external",
      desired: false,
      managed: false,
      state: "external",
    }, new Set())).toBe(true);
  });
});
