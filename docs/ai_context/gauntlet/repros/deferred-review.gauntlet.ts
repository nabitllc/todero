// Repro — waves 16, 17 and 18: a hand-in made while the organization was on
// hold was never reviewed, and nothing ever came back for it. The task sat in
// front of a person who was never told, and every task waiting on it waited
// with it (wave 17: one task held up six others for thirty-five minutes).
//
// The test itself is server/src/__tests__/repros/deferred-review.gauntlet.ts:
// it drives a real database, so it has to live where the server's own packages
// resolve. Importing it here registers its cases under this file, so the
// gauntlet runs it like any other repro:
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/deferred-review.gauntlet.ts
//
// Fails on origin/main (nothing reviews it when the organization starts again).
import "../../../../server/src/__tests__/repros/deferred-review.gauntlet.ts";
