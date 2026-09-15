import { describe, expect, it } from "vitest";
import {
  STRUCTURED_PLAN_UNREADABLE_NOTE,
  replyFromStructuredPlan,
  replyWhenStructuredPlanUnreadable,
} from "./structured-plan.js";

/**
 * The reply run 6752efd3 in the "Zz Recover" organization actually produced,
 * copied out of the dev database. The words are under `body` and a usable
 * plan is under `plan` — the schema did not hold, and the person was shown
 * this blob verbatim.
 */
const ZZ_RECOVER_REPLY =
  '{"body": "Here is the plan.", "plan": {"goal": "A weekly dinner table of five strangers in Tampa.",' +
  ' "features": [{"name": "One-page concept", "why": "Everyone needs the same picture of the idea",' +
  ' "done_when": "A one-page document exists and reads well"}, {"name": "Sign-up flow",' +
  ' "why": "People need a way in", "done_when": "The steps from interest to a seat are written down"}]}}';

describe("the reply the Zz Recover organization actually got", () => {
  it("reads the model's own sentence and the plan it filed under `plan`", () => {
    const shown = replyFromStructuredPlan(ZZ_RECOVER_REPLY);

    expect(shown).not.toBeNull();
    expect(shown!.startsWith("Here is the plan.")).toBe(true);
    expect(shown).toContain("```todero-plan");
    expect(shown).toContain("goal: A weekly dinner table of five strangers in Tampa.");
    expect(shown).toContain("One-page concept");
    expect(shown).toContain("STATUS: waiting");
    expect(shown).not.toContain('"done_when"');
  });

  it("is not answered with the canned sentence, because the plan is recoverable", () => {
    expect(replyWhenStructuredPlanUnreadable(ZZ_RECOVER_REPLY)).not.toBe(STRUCTURED_PLAN_UNREADABLE_NOTE);
  });
});

describe("a plan object with words around it", () => {
  it("keeps the sentence the model wrote in front of the object", () => {
    const reply = [
      "Sure, here is the plan:",
      JSON.stringify({
        message: "Tell me if the order is wrong.",
        goal: "Seat neighbors at monthly dinners",
        features: [{ name: "Sign-ups", why: "People need a way in", done_when: "A form is live" }],
        tasks: [{ title: "Draft the sign-up spec", feature: "Sign-ups", output: "A one-page spec", after: "" }],
      }),
    ].join("\n");

    const shown = replyFromStructuredPlan(reply);

    expect(shown).toContain("Sure, here is the plan:");
    expect(shown).toContain("Tell me if the order is wrong.");
    expect(shown).toContain("goal: Seat neighbors at monthly dinners");
    expect(shown).not.toContain('"done_when"');
  });
});

describe("a reply the schema did not hold and no plan can be read from", () => {
  it("keeps the preamble and shows the object's own words, never the blob", () => {
    const reply = [
      "Sure, here is the plan:",
      JSON.stringify({ message: "I still need to know which features matter.", features: [], tasks: [] }),
    ].join("\n");

    const shown = replyWhenStructuredPlanUnreadable(reply);

    expect(shown).not.toBeNull();
    expect(shown).toContain("Sure, here is the plan:");
    expect(shown).toContain("I still need to know which features matter.");
    expect(shown).not.toContain("{");
  });

  it("shows words, not the blob, when the model answered with a top-level array", () => {
    const reply = JSON.stringify([{ message: "Here is what I have.", features: [], tasks: [] }]);

    const shown = replyWhenStructuredPlanUnreadable(reply);

    expect(shown).toBe("Here is what I have.");
  });

  it("never posts a top-level array that carries no words either", () => {
    const shown = replyWhenStructuredPlanUnreadable('[{"features": [], "tasks": []}]');

    expect(shown).toBe(STRUCTURED_PLAN_UNREADABLE_NOTE);
  });

  it("keeps a prose reply that merely carries a fenced JSON block", () => {
    const reply = [
      "I could not finish the plan.",
      "",
      "```json",
      '{"features": []}',
      "```",
      "",
      "Tell me which features matter most and I will finish it.",
    ].join("\n");

    const shown = replyWhenStructuredPlanUnreadable(reply);

    expect(shown).toContain("I could not finish the plan.");
    expect(shown).toContain("Tell me which features matter most and I will finish it.");
    expect(shown).not.toContain("{");
    expect(shown).not.toContain("```");
  });

  it("falls back to one plain sentence when there are no words anywhere", () => {
    expect(replyWhenStructuredPlanUnreadable('{"goal": "", "features": [], "tasks": []}')).toBe(
      STRUCTURED_PLAN_UNREADABLE_NOTE,
    );
  });

  it("drops a status line the model wrote around the blob, so the turn hands back", () => {
    const reply = ['{"features": [], "tasks": []}', "", "STATUS: done"].join("\n");

    const shown = replyWhenStructuredPlanUnreadable(reply);

    expect(shown).toBe(STRUCTURED_PLAN_UNREADABLE_NOTE);
    expect(shown).not.toContain("STATUS");
  });

  it("leaves prose with no JSON in it alone, so the fenced parser still has it", () => {
    expect(replyWhenStructuredPlanUnreadable("Do you approve this plan?")).toBeNull();
    expect(
      replyWhenStructuredPlanUnreadable(["Here it is.", "```todero-plan", "goal: Ship it", "```"].join("\n")),
    ).toBeNull();
  });
});
