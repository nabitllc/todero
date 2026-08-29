import { describe, expect, it } from "vitest";
import { sanitizeInheritedToderoEnv } from "./server-utils.js";

describe("sanitizeInheritedToderoEnv", () => {
  it("drops the host-only Todero CLI command pointer", () => {
    expect(sanitizeInheritedToderoEnv({
      TODEROAI_CMD: "node /missing/todero/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});
