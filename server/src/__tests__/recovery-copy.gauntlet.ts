// Gauntlet item 0: what Todero posts to a person when a turn fails must be
// plain words. In the wave-1 live loop the recovery notices said "issue" and
// "continuation". This scans the sentence-like literals in the recovery
// service and the successful-run handoff (the text that ends up in comment
// bodies) and fails while any carries a banned word. Comments in the source
// and log lines (not sentences) are not scanned.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BANNED = /\b(issue|issues|disposition|handoff|wake|heartbeat|continuation)\b/i;
const FILES = ["service.ts", "successful-run-handoff.ts"].map((name) => path.resolve(__dirname, "..", "services", "recovery", name));

/** The source with its comments blanked (line count preserved), so a comment never reads as copy. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^(\s*)\/\/.*$/gm, (line) => " ".repeat(line.length));
}

/**
 * Every prose literal that reads like a sentence to a person: a double-quoted
 * string on one line, or a template literal, of six words or more, ending in
 * a full stop, question mark or exclamation mark.
 */
function proseLiterals(source: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const clean = withoutComments(source);
  const re = /"((?:[^"\\\n]|\\.){20,})"|`((?:[^`\\]|\\.){20,})`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean))) {
    const text = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
    if (text.split(" ").length < 6) continue;
    if (!/[.?!]["']?$/.test(text)) continue;
    const line = clean.slice(0, match.index).split("\n").length;
    out.push({ line, text });
  }
  return out;
}

describe("recovery copy", () => {
  for (const file of FILES) {
    it(`${path.basename(file)} posts no banned word to a person`, () => {
      const offenders = proseLiterals(readFileSync(file, "utf8")).filter((entry) => BANNED.test(entry.text));
      expect(offenders.map((entry) => `${entry.line}: ${entry.text.slice(0, 100)}`)).toEqual([]);
    });
  }
});
