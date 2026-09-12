import { describe, expect, it } from "vitest";
import { packRowFacts } from "./skill-pack-row";

describe("packRowFacts", () => {
  it("extracts version and metadata for a pack skill", () => {
    const item = {
      metadata: {
        version: 1,
        last_changed_because: "Updated with improvements",
        "todero-task-kinds": "[planning]",
        "todero-priority": 1,
      },
    };

    expect(packRowFacts(item)).toEqual({
      isPack: true,
      version: "1",
      lastChangedBecause: "Updated with improvements",
    });
  });

  it("returns nulls for non-pack skills", () => {
    const item = {
      metadata: null,
    };

    expect(packRowFacts(item)).toEqual({
      isPack: false,
      version: null,
      lastChangedBecause: null,
    });
  });

  it("returns nulls for skills without todero-task-kinds", () => {
    const item = {
      metadata: {
        version: 1,
        last_changed_because: "Some change",
      },
    };

    expect(packRowFacts(item)).toEqual({
      isPack: false,
      version: null,
      lastChangedBecause: null,
    });
  });

  it("handles missing version or because fields", () => {
    const item = {
      metadata: {
        "todero-task-kinds": "[planning]",
        "todero-priority": 1,
      },
    };

    expect(packRowFacts(item)).toEqual({
      isPack: true,
      version: null,
      lastChangedBecause: null,
    });
  });
});
