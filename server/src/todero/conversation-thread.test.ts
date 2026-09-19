import { describe, expect, it } from "vitest";
import type { Db } from "@todero/db";
import { SYSTEM_NOTICE_PRESENTATION } from "./conversation-outcome.js";
import {
  conversationTurnRole,
  loadConversationThread,
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

describe("conversationTurnRole", () => {
  const fromAgent = (id: string) => ({ authorType: "agent", authorAgentId: id, derivedAuthorAgentId: null });
  const fromPerson = { authorType: "user", authorAgentId: null, derivedAuthorAgentId: null };

  it("reads a person's comment as the other side of the conversation", () => {
    expect(conversationTurnRole(fromPerson, "agent-1")).toBe("user");
  });

  it("reads the agent's own comments as its own turns", () => {
    expect(conversationTurnRole(fromAgent("agent-1"), "agent-1")).toBe("agent");
  });

  it("reads another agent — the reviewer — as somebody talking to it", () => {
    expect(conversationTurnRole(fromAgent("judge-1"), "agent-1")).toBe("user");
  });

  it("keeps the single-agent reading when there is no reader", () => {
    expect(conversationTurnRole(fromAgent("judge-1"))).toBe("agent");
    expect(conversationTurnRole(fromPerson)).toBe("user");
  });
});

/**
 * The other half of the echo fix. `applyMissingPlanRecovery` marks Todero's
 * own hand-back as a system notice; this is the reason that marking matters —
 * the thread the model reads leaves it out. Posted unmarked under the agent's
 * id it came back as the agent's own last turn, and a 14B repeated Todero's
 * "stuck on the plan" sentence to the person as if it were its own.
 */
describe("what Todero's own notices do to the thread the model reads", () => {
  type Row = {
    body: string;
    authorType: string | null;
    authorAgentId: string | null;
    derivedAuthorAgentId: string | null;
    presentation: unknown;
  };

  function dbOf(rowsNewestFirst: Row[]): Db {
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => rowsNewestFirst,
    };
    return chain as unknown as Db;
  }

  const handBack: Row = {
    body: "Nova is stuck on the plan. Tell it what the first few pieces of work should be.",
    authorType: "agent",
    authorAgentId: "agent-1",
    derivedAuthorAgentId: null,
    presentation: SYSTEM_NOTICE_PRESENTATION,
  };
  const question: Row = {
    body: "Would you like me to proceed with this plan?",
    authorType: "agent",
    authorAgentId: "agent-1",
    derivedAuthorAgentId: null,
    presentation: null,
  };

  it("leaves Todero's hand-back out, and keeps what the agent really said", async () => {
    const turns = await loadConversationThread(dbOf([handBack, question]), {
      companyId: "company-1",
      issueId: "issue-1",
      readerAgentId: "agent-1",
    });
    expect(turns.map((turn) => turn.body)).toEqual(["Would you like me to proceed with this plan?"]);
  });
});
