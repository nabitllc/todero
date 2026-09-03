import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBody } from "./parse.ts";

test("reads the template fields", () => {
  const body = `## Summary

One sentence about **the change** with a [link](https://x.y).

## Cost

tokens=12,400 usd=0.31

## Proof

Screenshot: https://github.com/nabitllc/todero/actions/runs/1) and words.

## Session

Claude Code on G14
`;
  const p = parseBody(body);
  assert.equal(p.summary, "One sentence about the change with a link.");
  assert.equal(p.tokens, 12400);
  assert.equal(p.usd, 0.31);
  assert.equal(p.proof, "https://github.com/nabitllc/todero/actions/runs/1");
  assert.equal(p.session, "Claude Code on G14");
});

test("falls back to the first paragraph and leaves cost blank", () => {
  const p = parseBody("<!-- hidden -->\n\n# Title\n\nFirst paragraph here.\n\nSecond.");
  assert.equal(p.summary, "First paragraph here.");
  assert.equal(p.tokens, null);
  assert.equal(p.usd, null);
  assert.equal(p.proof, null);
});

test("clips long summaries and survives an empty body", () => {
  const long = parseBody("Summary: " + "word ".repeat(80));
  assert.ok(long.summary.length <= 160 && long.summary.endsWith("…"));
  assert.deepEqual(parseBody(null), { summary: "", tokens: null, usd: null, proof: null, session: null });
});
