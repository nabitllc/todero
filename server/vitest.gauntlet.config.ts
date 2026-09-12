// The gauntlet's item checks: tests that are meant to fail until a work item
// is done (docs/ai_context/gauntlet/checks.json). They are named
// *.gauntlet.ts, a name the ordinary suite never picks up, so CI stays green
// while an item is open; the gauntlet runs them by path through this config.
// Built by spreading, not mergeConfig, so the include is replaced.
import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // The item checks live beside the code they name; the repros live in the
    // gauntlet's own folder, one file per fixed bug, and run through the same
    // config so they keep working long after their item is closed.
    include: ["src/**/*.gauntlet.ts", "../docs/ai_context/gauntlet/repros/**/*.gauntlet.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
