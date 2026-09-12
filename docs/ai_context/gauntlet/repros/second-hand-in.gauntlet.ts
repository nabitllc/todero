// Repro — wave 7, gauntlet item 0's promise: a second hand-in after a reviewer's
// send-back failed to update the task's Output document, so the hand-in was
// dropped and a handoff notice followed.
//
// The test itself is server/src/todero/issue-document-write.test.ts (an
// ordinary test, so CI keeps guarding it); importing it here registers its
// cases under this file, so the gauntlet runs it like any other repro:
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/second-hand-in.gauntlet.ts
//
// Fails on origin/main, passes on fix/second-hand-in-keeps-its-document.
import "../../../../server/src/todero/issue-document-write.test.ts";
