import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Brain2 machine budget (2026-11-24): each laptop exports BRAIN2_TEST_WORKERS so parallel sessions
    // don't each take half the cores. Unset (CI, a cloud VM) -> vitest's default.
    maxWorkers: Number(process.env.BRAIN2_TEST_WORKERS) || undefined,
    projects: [
      "packages/shared",
      "packages/skills-catalog",
      "packages/db",
      "packages/adapter-utils",
      "packages/adapters/claude-local",
      "packages/adapters/codex-local",
      "packages/adapters/cursor-cloud",
      "packages/adapters/cursor-local",
      "packages/adapters/gemini-local",
      "packages/adapters/grok-local",
      "packages/adapters/kimi-local",
      "packages/adapters/openclaw-gateway",
      "packages/adapters/opencode-local",
      "packages/adapters/pi-local",
      "packages/plugins/sdk",
      "packages/plugins/create-todero-plugin",
      "packages/plugins/sandbox-providers/daytona",
      "server",
      "ui",
      "cli",
    ],
  },
});
