// Gauntlet item 1: a pack skill's row shows its version and its because-line.
// Fails until ui/src/lib/skill-pack-row.ts exists.
import { describe, expect, it } from "vitest";
import { packRowFacts } from "./skill-pack-row";

const packItem = {
  id: "s1",
  key: "company/c1/todero-plan-a-project",
  name: "todero-plan-a-project",
  metadata: {
    version: 1,
    upstream: "C:/Development/Mich-Brain2/Playbooks/PRD_Framework.md",
    last_synced: "2026-09-11",
    last_changed_because: "Shipped with the skill pack.",
    "todero-task-kinds": "[planning]",
    "todero-priority": 1,
  },
};

describe("packRowFacts", () => {
  it("reads the version and the because-line off a pack skill", () => {
    expect(packRowFacts(packItem)).toEqual({
      isPack: true,
      version: "1",
      lastChangedBecause: "Shipped with the skill pack.",
    });
  });

  it("knows a command-line skill is not part of the pack", () => {
    expect(packRowFacts({ ...packItem, key: "nabitllc/todero/todero", metadata: null })).toEqual({
      isPack: false,
      version: null,
      lastChangedBecause: null,
    });
  });

  it("shows a reset's because-line after a reset", () => {
    const reset = { ...packItem, metadata: { ...packItem.metadata, version: 2, last_changed_because: "Reset to the original" } };
    expect(packRowFacts(reset)).toMatchObject({ version: "2", lastChangedBecause: "Reset to the original" });
  });
});
