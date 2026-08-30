import { afterEach, describe, expect, it } from "vitest";
import {
  aliasToderoEnvOntoLegacy,
  isOperatorOwnedEnvKey,
  operatorEnvKey,
  readOperatorEnv,
  setOperatorEnv,
} from "./operator-env.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("operator env dual-read", () => {
  it("prefers TODERO_* over PAPERCLIP_*", () => {
    const env = {
      TODERO_HOME: "/todero-home",
      PAPERCLIP_HOME: "/legacy-home",
    };
    expect(readOperatorEnv("HOME", env)).toBe("/todero-home");
    expect(operatorEnvKey("HOME")).toBe("TODERO_HOME");
  });

  it("falls back to PAPERCLIP_* when TODERO_* is unset", () => {
    const env = { PAPERCLIP_MIGRATION_AUTO_APPLY: "true" };
    expect(readOperatorEnv("MIGRATION_AUTO_APPLY", env)).toBe("true");
  });

  it("aliases TODERO_* onto unset PAPERCLIP_* keys", () => {
    const env: NodeJS.ProcessEnv = {
      TODERO_BIND: "loopback",
      PAPERCLIP_HOME: "/legacy",
    };
    aliasToderoEnvOntoLegacy(env);
    expect(env.PAPERCLIP_BIND).toBe("loopback");
    expect(env.PAPERCLIP_HOME).toBe("/legacy");
  });

  it("owns both TODERO_ and PAPERCLIP_ keys", () => {
    expect(isOperatorOwnedEnvKey("TODERO_AGENT_JWT_SECRET")).toBe(true);
    expect(isOperatorOwnedEnvKey("PAPERCLIP_AGENT_JWT_SECRET")).toBe(true);
    expect(isOperatorOwnedEnvKey("DATABASE_URL")).toBe(false);
  });

  it("setOperatorEnv writes TODERO_* and mirrors PAPERCLIP_*", () => {
    const env: NodeJS.ProcessEnv = {};
    setOperatorEnv("HOME", "/todero-home", env);
    expect(env.TODERO_HOME).toBe("/todero-home");
    expect(env.PAPERCLIP_HOME).toBe("/todero-home");
  });
});
