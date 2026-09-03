import { test } from "node:test";
import assert from "node:assert/strict";
import { issueSession, safeEqual, verifySession } from "./session.ts";

const secret = "test-secret";

test("a fresh session verifies; a tampered or expired one does not", async () => {
  const { value } = await issueSession(secret);
  assert.equal(await verifySession(secret, value), true);
  assert.equal(await verifySession("other", value), false);
  assert.equal(await verifySession(secret, value.slice(0, -1) + "x"), false);
  assert.equal(await verifySession(secret, undefined), false);
  assert.equal(await verifySession(secret, "junk"), false);
  const expired = await issueSession(secret, Date.now() - 40 * 24 * 60 * 60 * 1000);
  assert.equal(await verifySession(secret, expired.value), false);
});

test("safeEqual compares without leaking on length", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
  assert.equal(safeEqual("", ""), true);
});
