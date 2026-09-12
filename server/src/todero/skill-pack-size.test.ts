// The wizard's window hint (ui/src/lib/local-llm-window.ts) compares the
// model's window with SKILL_PACK_FULL_CHARS, a measured constant in shared.
// This keeps the constant honest against the files actually shipped: when a
// pack skill is rewritten, the number moves with it or this test says so.
import { describe, expect, it } from "vitest";
import { parseFrontmatterMarkdown, SKILL_PACK_FULL_CHARS } from "@todero/shared";
import { skillBodyForModel } from "./skill-pack.js";
import { readShippedPackSkills } from "./skill-pack-source.js";

describe("SKILL_PACK_FULL_CHARS", () => {
  it("is within a tenth of the shipped pack's model-facing size", async () => {
    const shipped = await readShippedPackSkills();
    // readShippedPackSkills returns the pack skills only: each carries its facts.
    const pack = shipped.filter((entry) => entry.facts);
    expect(pack.length).toBeGreaterThanOrEqual(10);
    const measured = pack.reduce(
      (sum, entry) => sum + skillBodyForModel(parseFrontmatterMarkdown(entry.markdown).body).length,
      0,
    );
    expect(Math.abs(measured - SKILL_PACK_FULL_CHARS) / measured).toBeLessThan(0.1);
  });
});
