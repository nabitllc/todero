// Gauntlet item 0: what Todero posts to a person when a turn fails must be
// plain words. In the wave-1 live loop the recovery notices said "issue" and
// "continuation". This scans the sentence-like literals in the recovery
// service and the successful-run handoff (the text that ends up in comment
// bodies) and fails while any carries a banned word. Comments in the source
// and log lines (not sentences) are not scanned.
//
// Two corrections to this check, made by the fixer on 2026-09-11 and called out
// in the open because an item check is not normally edited:
//   1. "run" and "runs" were missing from BANNED even though the item text
//      names them alongside the rest. Two notices a person reads in the Inbox
//      still said "run" and the check called them clean.
//   2. The old scanner was a regex over the whole file. A backtick inside a
//      double-quoted string (markdown inline code, and `const fence = "`" + …`)
//      opened a bogus template-literal span that swallowed dozens of real
//      lines — successful-run-handoff.ts reported 6 sentences out of 580 lines,
//      and the worst offender in the file was inside a swallowed span. The
//      scanner below reads the file the way the language does instead:
//      comments, strings, template literals and regular expressions are each
//      consumed whole, in order, so nothing hides behind anything else.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BANNED = /\b(issue|issues|disposition|handoff|wake|heartbeat|continuation|run|runs)\b/i;
const FILES = ["service.ts", "successful-run-handoff.ts"].map((name) => path.resolve(__dirname, name));

/** A `/` here opens a regular expression, not a division. */
const REGEX_CAN_FOLLOW_CHAR = "(,=:[!&|?{};+-*%~^<>";
const REGEX_CAN_FOLLOW_WORD = new Set([
  "return",
  "case",
  "typeof",
  "instanceof",
  "in",
  "of",
  "do",
  "else",
  "yield",
  "await",
  "new",
  "delete",
  "void",
]);

/**
 * Every string and template literal in the file, with the line it starts on.
 * One pass, in source order: a comment, a regular expression and a string each
 * consume their own characters, so a quote or a backtick inside one of them is
 * never mistaken for the start of another.
 */
function stringLiterals(source: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let prevChar = "";
  let prevWord = "";
  while (i < n) {
    const ch = source[i]!;
    if (ch === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === "/" && (prevChar === "" || REGEX_CAN_FOLLOW_CHAR.includes(prevChar) || REGEX_CAN_FOLLOW_WORD.has(prevWord))) {
      i += 1;
      let inClass = false;
      while (i < n && source[i] !== "\n") {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "/" && !inClass) {
          i += 1;
          break;
        }
        i += 1;
      }
      prevChar = "/";
      prevWord = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const startLine = line;
      let text = "";
      i += 1;
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
          text += source.slice(i, i + 2);
          if (source[i + 1] === "\n") line += 1;
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        if (c === "\n") {
          line += 1;
          // An unterminated single-line string means the file does not parse;
          // stop the literal at the newline rather than swallowing the rest.
          if (quote !== "`") {
            i += 1;
            break;
          }
        }
        // `${…}` is code, not copy. Skip it, brace-balanced.
        if (quote === "`" && c === "$" && source[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            else if (source[i] === "\n") line += 1;
            i += 1;
          }
          text += " ";
          continue;
        }
        text += c;
        i += 1;
      }
      out.push({ line: startLine, text });
      prevChar = quote;
      prevWord = "";
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let word = "";
      while (i < n && /[A-Za-z0-9_$]/.test(source[i]!)) {
        word += source[i];
        i += 1;
      }
      prevWord = word;
      prevChar = word[word.length - 1]!;
      continue;
    }
    if (!/\s/.test(ch)) {
      prevChar = ch;
      prevWord = "";
    }
    i += 1;
  }
  return out;
}

/**
 * Every literal that reads like a sentence to a person: six words or more,
 * ending in a full stop, question mark or exclamation mark.
 */
function proseLiterals(source: string): Array<{ line: number; text: string }> {
  return stringLiterals(source)
    .map((entry) => ({ line: entry.line, text: entry.text.replace(/\s+/g, " ").trim() }))
    .filter((entry) => entry.text.split(" ").length >= 6 && /[.?!]["']?$/.test(entry.text));
}

describe("recovery copy", () => {
  for (const file of FILES) {
    it(`${path.basename(file)} posts no banned word to a person`, () => {
      const offenders = proseLiterals(readFileSync(file, "utf8")).filter((entry) => BANNED.test(entry.text));
      expect(offenders.map((entry) => `${entry.line}: ${entry.text.slice(0, 100)}`)).toEqual([]);
    });
  }
});
