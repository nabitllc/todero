// The gauntlet's item checks: tests that are meant to fail until a work item
// is done (docs/ai_context/gauntlet/checks.json). They are named
// *.gauntlet.test.* and excluded from the ordinary suite so CI stays green
// while an item is open; the gauntlet runs them by path through this config.
// Built by spreading, not mergeConfig: merging would keep the base exclusion.
import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/*.gauntlet.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
