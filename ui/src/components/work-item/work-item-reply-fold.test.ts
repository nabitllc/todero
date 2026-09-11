import { describe, expect, it } from "vitest";
import { REPLY_FOLD_LINES, replyFolds, replyLineCount } from "./WorkItemFormattedReply";

describe("replyLineCount", () => {
  it("is zero for nothing", () => {
    expect(replyLineCount("")).toBe(0);
    expect(replyLineCount("   \n\n")).toBe(0);
  });

  it("counts a single line as one", () => {
    expect(replyLineCount("hello")).toBe(1);
  });

  it("counts every line between the first and the last", () => {
    expect(replyLineCount("a\nb\n\nc")).toBe(4);
  });

  it("does not count blank lines trailing the reply", () => {
    expect(replyLineCount("a\nb\n\n\n")).toBe(2);
  });
});

describe("replyFolds", () => {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");

  it("leaves a short reply alone", () => {
    expect(replyFolds(lines(REPLY_FOLD_LINES))).toBe(false);
  });

  it("folds one line past the limit", () => {
    expect(replyFolds(lines(REPLY_FOLD_LINES + 1))).toBe(true);
  });

  it("takes a limit of its own", () => {
    expect(replyFolds(lines(3), 2)).toBe(true);
    expect(replyFolds(lines(2), 2)).toBe(false);
  });
});
