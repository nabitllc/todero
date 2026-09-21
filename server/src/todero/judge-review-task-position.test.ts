/**
 * Driving the reviewer itself, not a hand-built copy of its call site.
 *
 * Wave 4 of the improvement loop: whether a task is the one its feature ends
 * with — and so whether the feature's finish line is something the reviewer
 * must check or only background it is told about — is decided in
 * `reviewConversationHandIn`, on one line, and nowhere else. A test that works
 * the plan out for itself proves the rule but not the wiring, so this one goes
 * through the real function and reads the prompt the model was actually sent.
 *
 * It lives in its own file because it stands the reviewer's three database
 * collaborators in: `judge-review.test.ts` next door proves the opposite, that
 * a running organization does reach the database, and the two cannot share a
 * file.
 */
import { describe, expect, it, vi } from "vitest";
import { reviewConversationHandIn } from "./judge-review.js";

/** Two features: one of two tasks, one of a single task. */
const PLAN_DOCUMENT = [
  "```todero-plan",
  "goal: Create two one-page guides for houseplants that survive a dark flat.",
  "features:",
  "  - name: Draft guides",
  "    why: To produce the content.",
  "    done_when: Two drafts, each naming the plant and how often to water it.",
  "  - name: Publish guides",
  "    why: To get them in front of people.",
  "    done_when: Both guides published.",
  "tasks:",
  "  - title: Draft the first guide",
  "    feature: Draft guides",
  "    output: The first guide draft.",
  "  - title: Draft the second guide",
  "    feature: Draft guides",
  "    output: The second guide draft.",
  "    after: Draft the first guide",
  "  - title: Publish both guides",
  "    feature: Publish guides",
  "    output: Both guides published.",
  "    after: Draft the second guide",
].join("\n");

vi.mock("./judge-agent.js", async () => {
  const real = await vi.importActual<typeof import("./judge-agent.js")>("./judge-agent.js");
  return {
    ...real,
    findJudgeAgentForLead: async () => ({
      id: "judge-1",
      name: "Ash's reviewer",
      companyId: "co-1",
      status: "idle",
      adapterType: "http",
      adapterConfig: { url: "http://127.0.0.1:11434/v1/chat/completions", model: "qwen2.5-coder:14b" },
    }),
  };
});

vi.mock("../services/documents.js", () => ({
  documentService: () => ({ getIssueDocumentByKey: async () => ({ body: PLAN_DOCUMENT }) }),
}));

vi.mock("../services/company-skills.js", () => ({
  companySkillService: () => ({ listFull: async () => [] }),
}));

const TWO_DRAFTS = "Two drafts, each naming the plant and how often to water it.";

/** The reviewer's prompt for one task of that plan, as the model received it. */
async function promptFor(title: string): Promise<string> {
  let prompt = "";
  const result = await reviewConversationHandIn({} as never, {
    issue: {
      id: "issue-1",
      companyId: "co-1",
      title,
      description: "<!-- todero-type: Task -->\nGoal: two guides.",
      parentId: "parent-1",
    },
    deliverable: "Pothos — low to bright indirect light. Water when the top inch is dry.",
    leadAgentId: "agent-1",
    companyStatus: "active",
    autoAcceptWhenJudgePasses: true,
    fetcher: (async (_url: string, init: RequestInit) => {
      prompt = JSON.parse(String(init.body)).messages[1].content;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "VERDICT: pass\n1: met\nGood." } }] }),
      } as Response;
    }) as unknown as typeof fetch,
  });
  // The review really ran: a prompt that was never sent proves nothing.
  expect(result.skipped).toBeNull();
  return prompt;
}

describe("the reviewer judges a task on its own hand-in", () => {
  it("gives a task in the middle of a feature the finish line as background, never as a check", async () => {
    const prompt = await promptFor("Draft the first guide");
    expect(prompt).toContain("It has to be true that:\n1. The hand-in is The first guide draft.");
    expect(prompt).not.toContain(`1. ${TWO_DRAFTS}`);
    expect(prompt).not.toContain(`Done when: ${TWO_DRAFTS}`);
    expect(prompt).toContain("one step of Draft guides");
    expect(prompt).toContain("judge only this task's hand-in");
  });

  it("still holds the task its feature ends with to that finish line", async () => {
    const prompt = await promptFor("Draft the second guide");
    expect(prompt).toContain(`Done when: ${TWO_DRAFTS}`);
    expect(prompt).toContain(`It has to be true that:\n1. ${TWO_DRAFTS}`);
    expect(prompt).not.toContain("judge only this task's hand-in");
  });

  it("treats a feature with a single task as ended by that task", async () => {
    const prompt = await promptFor("Publish both guides");
    expect(prompt).toContain("Done when: Both guides published.");
    expect(prompt).not.toContain("judge only this task's hand-in");
  });
});
