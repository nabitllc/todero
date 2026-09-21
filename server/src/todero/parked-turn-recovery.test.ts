// Which parked tasks are offered the corrective turn when an organization
// starts again, decided on the task's own text and the last things said on it.
//
// Wave 5 of the improvement loop. The corrective turn added in wave 4 fires at
// the moment a turn ends badly. A task parked before that existed — or parked
// while Todero was being updated — is never offered it, because nothing wakes
// it. Wave 20 reopened wave 19's organization and sat there: two tasks parked
// with a reply that asked nothing, five tasks queued behind them, no turns in
// fifteen minutes.
import { describe, expect, it } from "vitest";
import { descriptionWithEmptyTurnTries, descriptionWithReviewMarker } from "./conversation-outcome.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import { EMPTY_TURN_MAX_TRIES } from "./empty-turn-recovery.js";
import {
  findParkedTasksWithNothingToAnswer,
  type ParkedTask,
} from "./parked-turn-recovery.js";

const BRIEF = "<!-- todero-type: Task -->\nDraft the second guide.";

/** ZZGAAAAAAAAAAA-4's reply: its own brief read back, and no guide. */
const NOTHING_TO_ANSWER = [
  "**ZZGAAAAAAAAA-4**",
  "- **Goal:** Create four one-page guides for houseplants that survive a dark flat.",
  "- **Feature:** Draft guides — To produce the initial content for the one-page guides.",
  "- **Done when:** Four drafts, each naming the plant, the light it needs, and how often to water it.",
].join("\n");

const A_QUESTION = "Could you please provide the four draft guides so I can review them?";

const A_HAND_IN = [
  "**Pothos (Epipremnum aureum)**",
  "- **Light Needs:** Thrives in low light but prefers bright, indirect light.",
  "- **Watering:** Water when the top inch of soil is dry.",
].join("\n");

function task(over: Partial<ParkedTask> = {}): ParkedTask {
  return {
    id: "task-1",
    companyId: "company-1",
    identifier: "ZZ-4",
    title: "Draft the second guide",
    description: descriptionWithWaitingMarker(BRIEF, true),
    status: "blocked",
    parentId: "parent-1",
    assigneeAgentId: "worker-1",
    lastComments: [{ by: "agent", body: NOTHING_TO_ANSWER }],
    ...over,
  };
}

const found = (over: Partial<ParkedTask> = {}) =>
  findParkedTasksWithNothingToAnswer([task(over)]).map((row) => row.id);

describe("which parked tasks have nothing on them to answer", () => {
  it("takes the one parked with a reply that asked nothing and handed nothing in", () => {
    expect(found()).toEqual(["task-1"]);
  });

  it("leaves the one that asked the person something", () => {
    expect(found({ lastComments: [{ by: "agent", body: A_QUESTION }] })).toEqual([]);
  });

  it("leaves the one that handed work in", () => {
    expect(found({ lastComments: [{ by: "agent", body: A_HAND_IN }] })).toEqual([]);
  });

  it("leaves the one a person has already answered", () => {
    expect(
      found({
        lastComments: [
          { by: "agent", body: NOTHING_TO_ANSWER },
          { by: "person", body: "Just write the guide for the pothos." },
        ],
      }),
    ).toEqual([]);
  });

  it("leaves the one Todero has already asked once", () => {
    expect(
      found({ description: descriptionWithEmptyTurnTries(descriptionWithWaitingMarker(BRIEF, true), EMPTY_TURN_MAX_TRIES) }),
    ).toEqual([]);
  });

  it("still takes it when Todero's own note is the last thing on the task", () => {
    expect(
      found({
        lastComments: [
          { by: "agent", body: NOTHING_TO_ANSWER },
          { by: "system", body: "This organization was put on hold." },
        ],
      }),
    ).toEqual(["task-1"]);
  });

  it("leaves a hand-in that is waiting for the person to accept it", () => {
    expect(
      found({ description: descriptionWithReviewMarker(descriptionWithWaitingMarker(BRIEF, true), true) }),
    ).toEqual([]);
  });

  it("leaves a task that is only waiting on the work before it", () => {
    expect(found({ description: BRIEF })).toEqual([]);
  });

  it("leaves the conversation task, a task nobody is on, and a running task", () => {
    expect(found({ parentId: null })).toEqual([]);
    expect(found({ assigneeAgentId: null })).toEqual([]);
    expect(found({ status: "in_progress" })).toEqual([]);
  });

  it("leaves one with nothing said on it at all", () => {
    expect(found({ lastComments: [] })).toEqual([]);
  });
});
