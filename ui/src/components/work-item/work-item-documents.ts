/**
 * The document keys the task screen reads. They are the server's own keys
 * (`server/src/todero/conversation-outcome.ts` and `manager-wave.ts`); naming
 * them once here keeps the three spellings from drifting apart in the UI.
 */

/** The deliverable an agent hands in, with a revision per hand-in. */
export const CONVERSATION_OUTPUT_DOCUMENT_KEY = "output";

/** The manager's rewritten brief for work that came back: "What to change". */
export const MANAGER_GUIDANCE_DOCUMENT_KEY = "guidance";
