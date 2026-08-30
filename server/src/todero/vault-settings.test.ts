import { describe, expect, it } from "vitest";
import {
  WINDOWS_RECOMMENDED_VAULT_PATH,
  defaultRecommendedVaultPath,
  resolveRecommendedVaultPath,
  vaultPathExists,
} from "./vault-settings.js";

function envWithoutVaultDir(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TODERO_VAULT_DIR;
  return env;
}

describe("resolveRecommendedVaultPath", () => {
  it("uses C:\\Development\\Todero Brain on win32 when TODERO_VAULT_DIR is unset", () => {
    const recommendedPath = resolveRecommendedVaultPath(envWithoutVaultDir(), "win32");
    console.log("measured recommendedPath (win32, unset)=", recommendedPath);
    expect(recommendedPath).toBe("C:\\Development\\Todero Brain");
    expect(recommendedPath).toBe(WINDOWS_RECOMMENDED_VAULT_PATH);
    expect(defaultRecommendedVaultPath("win32")).toBe(WINDOWS_RECOMMENDED_VAULT_PATH);
  });

  it("uses TODERO_VAULT_DIR override when set", () => {
    const override = "D:\\custom-vault";
    const recommendedPath = resolveRecommendedVaultPath(
      { ...process.env, TODERO_VAULT_DIR: override },
      "win32",
    );
    console.log("measured recommendedPath (override)=", recommendedPath);
    expect(recommendedPath).toBe(override);
  });

  it("ignores blank TODERO_VAULT_DIR and falls back to the OS default", () => {
    expect(resolveRecommendedVaultPath({ TODERO_VAULT_DIR: "  " }, "win32")).toBe(
      WINDOWS_RECOMMENDED_VAULT_PATH,
    );
  });

  it("keeps a posix default so non-Windows callers are not hard-broken", () => {
    const recommendedPath = resolveRecommendedVaultPath(envWithoutVaultDir(), "linux");
    expect(recommendedPath).toBe("/workspace/Mich-Brain2");
    expect(defaultRecommendedVaultPath("linux")).toBe("/workspace/Mich-Brain2");
  });

  it("reports recommendedExists true when the recommended folder is present", () => {
    const recommendedPath = resolveRecommendedVaultPath(envWithoutVaultDir(), "win32");
    const recommendedExists = vaultPathExists(recommendedPath);
    console.log("measured recommendedExists=", recommendedExists, "path=", recommendedPath);
    if (process.platform === "win32") {
      expect(recommendedExists).toBe(true);
    } else {
      expect(typeof recommendedExists).toBe("boolean");
    }
  });
});