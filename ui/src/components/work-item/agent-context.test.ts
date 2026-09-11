import { describe, expect, it } from "vitest";
import { readAgentContext, whatAgentSeesTitle } from "./agent-context";

describe("readAgentContext", () => {
  it("is null when the turn stored nothing", () => {
    expect(readAgentContext(null)).toBeNull();
    expect(readAgentContext(undefined)).toBeNull();
    expect(readAgentContext("a string")).toBeNull();
    expect(readAgentContext({})).toBeNull();
  });

  it("is null when the bag holds only machinery of its own", () => {
    expect(readAgentContext({ somethingElse: 1 })).toBeNull();
  });

  it("reads the brief, the standing instructions and the turn", () => {
    const context = readAgentContext({
      toderoTaskMarkdown: "# The task",
      toderoSkillText: "Always say what you did.",
      toderoTurnInstruction: "Carry on.",
    });
    expect(context?.brief).toBe("# The task");
    expect(context?.standingInstructions).toBe("Always say what you did.");
    expect(context?.turnInstruction).toBe("Carry on.");
  });

  it("reads who the agent was told it is", () => {
    const context = readAgentContext({
      toderoIdentity: { agentName: "Nova", roleTitle: "Writer", companyName: "Tampa Supper Club", mission: "Fill seats" },
    });
    expect(context?.agentName).toBe("Nova");
    expect(context?.roleTitle).toBe("Writer");
    expect(context?.companyName).toBe("Tampa Supper Club");
    expect(context?.mission).toBe("Fill seats");
  });

  it("keeps the agent's own turns apart from the person's", () => {
    const context = readAgentContext({
      toderoThread: [
        { role: "user", body: "Do the thing." },
        { role: "agent", body: "Done." },
      ],
    });
    expect(context?.thread).toEqual([
      { role: "person", body: "Do the thing." },
      { role: "agent", body: "Done." },
    ]);
  });

  it("skips thread entries with nothing in them", () => {
    const context = readAgentContext({
      toderoThread: [null, { role: "user" }, { role: "user", body: "   " }, { role: "user", body: "Real." }],
    });
    expect(context?.thread).toEqual([{ role: "person", body: "Real." }]);
  });

  it("survives a thread that is not a list", () => {
    expect(readAgentContext({ toderoThread: "nope", toderoTaskMarkdown: "x" })?.thread).toEqual([]);
  });
});

describe("whatAgentSeesTitle", () => {
  it("uses the agent's name", () => {
    expect(whatAgentSeesTitle("Nova")).toBe("What Nova sees");
  });

  it("falls back rather than inventing one", () => {
    expect(whatAgentSeesTitle(null)).toBe("What the agent sees");
    expect(whatAgentSeesTitle("  ")).toBe("What the agent sees");
  });
});
