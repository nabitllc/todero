// Repro — wave 3, gauntlet item 0: the reviewer's thinking time derailed the loop.
//
// The test itself is server/src/__tests__/repros/review-window.gauntlet.ts: it
// drives a real heartbeat turn against an embedded database, so it has to live
// where the server's own packages resolve. Importing it here registers its
// cases under this file, so the gauntlet runs it like any other repro:
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/review-window.gauntlet.ts
//
// Fails on origin/main (the reviewer is asked while the task is still
// `in_progress`), passes on fix/local-model-slow-turns.
import "../../../../server/src/__tests__/repros/review-window.gauntlet.ts";
