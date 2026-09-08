import { describe, expect, it } from "vitest";
import {
  descriptionWithWaitingMarker,
  isConversationalHttpAgent,
  planConversationDisposition,
  readConversationDisposition,
  WAITING_ON_YOU_MARKER,
} from "./conversation-thread.js";

describe("conversational http agent detection", () => {
  it("recognizes the wizard's local LLM hire", () => {
    expect(
      isConversationalHttpAgent({
        adapterType: "http",
        adapterConfig: { url: "http://127.0.0.1:11434/v1/chat/completions" },
      }),
    ).toBe(true);
  });

  it("leaves webhook http agents and other adapters alone", () => {
    expect(isConversationalHttpAgent({ adapterType: "http", adapterConfig: { url: "https://x.test/hook" } })).toBe(false);
    expect(isConversationalHttpAgent({ adapterType: "claude_local", adapterConfig: {} })).toBe(false);
    expect(isConversationalHttpAgent({ adapterType: "http", adapterConfig: null })).toBe(false);
  });
});

describe("waiting-on-you marker", () => {
  it("adds the marker under the type marker, where the work-item view puts it", () => {
    const next = descriptionWithWaitingMarker("<!-- todero-type: Task -->\nDo the thing\n", true);
    expect(next).toBe(`<!-- todero-type: Task -->\n${WAITING_ON_YOU_MARKER}\nDo the thing\n`);
  });

  it("adds the marker at the top when there is no type marker", () => {
    expect(descriptionWithWaitingMarker("Do the thing", true)).toBe(`${WAITING_ON_YOU_MARKER}\nDo the thing`);
  });

  it("does not duplicate an existing marker and can remove it", () => {
    const withMarker = descriptionWithWaitingMarker("<!-- todero-type: Task -->\nDo the thing\n", true);
    expect(descriptionWithWaitingMarker(withMarker, true)).toBe(withMarker);
    expect(descriptionWithWaitingMarker(withMarker, false)).toBe("<!-- todero-type: Task -->\nDo the thing\n");
  });
});

describe("conversation disposition", () => {
  it("reads only the two dispositions the adapter can emit", () => {
    expect(readConversationDisposition({ toderoDisposition: "done" })).toBe("done");
    expect(readConversationDisposition({ toderoDisposition: "waiting" })).toBe("waiting");
    expect(readConversationDisposition({ toderoDisposition: "maybe" })).toBeNull();
    expect(readConversationDisposition(null)).toBeNull();
  });

  it("hands the turn back as blocked + waiting-on-you", () => {
    const plan = planConversationDisposition({
      issue: { status: "in_progress", description: "<!-- todero-type: Task -->\nPlan it\n" },
      disposition: "waiting",
    });
    expect(plan?.status).toBe("blocked");
    expect(plan?.description).toContain(WAITING_ON_YOU_MARKER);
  });

  it("closes the task on done and clears the marker", () => {
    const plan = planConversationDisposition({
      issue: { status: "in_progress", description: `<!-- todero-type: Task -->\n${WAITING_ON_YOU_MARKER}\nPlan it\n` },
      disposition: "done",
    });
    expect(plan?.status).toBe("done");
    expect(plan?.description).not.toContain(WAITING_ON_YOU_MARKER);
  });

  it("does nothing when the agent no longer owns the issue state", () => {
    expect(
      planConversationDisposition({ issue: { status: "blocked", description: null }, disposition: "waiting" }),
    ).toBeNull();
    expect(
      planConversationDisposition({ issue: { status: "done", description: null }, disposition: "done" }),
    ).toBeNull();
  });
});
