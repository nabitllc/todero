import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // *.gauntlet.test.* are the gauntlet's item checks, which fail on purpose
    // until their work item is done; vitest.gauntlet.config.ts runs them.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.gauntlet.test.*"],
  },
});
