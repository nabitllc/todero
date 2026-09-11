import { describe, expect, it } from "vitest";
import { buildThreadItems, lastVerdict, markHandIn, markVerdicts } from "./work-item-thread";
import type { WorkItemActivityItem } from "./work-item-model";

const PASS = "I reviewed this and it does what the task asked. It is ready for you to accept.";
const FAIL = "I reviewed this and it is not finished yet. Sending it back with what to change.";

const agent = (id: string, body: string): WorkItemActivityItem => ({ id, kind: "agent", name: "Nova", body });
const human = (id: string): WorkItemActivityItem => ({ id, kind: "human", name: "You", body: "ok" });
const system = (id: string): WorkItemActivityItem => ({ id, kind: "system", text: "Moved to To do" });

describe("markVerdicts", () => {
  it("leaves an ordinary reply alone", () => {
    expect(markVerdicts([agent("a", "Here is the draft.")])[0].kind).toBe("agent");
  });

  it("turns a reviewer's reply into a verdict", () => {
    const [item] = markVerdicts([agent("a", `${PASS}\n\nIt covers every point.`)]);
    expect(item.kind).toBe("verdict");
    expect(item.verdict?.verdict).toBe("pass");
    expect(item.verdict?.note).toBe("It covers every point.");
  });

  it("never touches what a person wrote, even if they quote the reviewer", () => {
    const [item] = markVerdicts([{ id: "h", kind: "human", name: "You", body: PASS }]);
    expect(item.kind).toBe("human");
  });
});

describe("markHandIn", () => {
  const thread = [agent("a1", "Working on it."), human("h1"), agent("a2", "Done.")];

  it("does nothing while nothing is waiting", () => {
    expect(markHandIn(thread, { reviewPending: false, version: 2 })).toBe(thread);
  });

  it("does nothing when there is no version to open", () => {
    expect(markHandIn(thread, { reviewPending: true, version: null })).toBe(thread);
  });

  it("turns the last reply into the hand-in card", () => {
    const marked = markHandIn(thread, { reviewPending: true, version: 2 });
    expect(marked[2].kind).toBe("handed-in");
    expect(marked[2].version).toBe(2);
    expect(marked[0].kind).toBe("agent");
  });

  it("leaves the thread alone when no agent has said anything", () => {
    const only = [human("h1")];
    expect(markHandIn(only, { reviewPending: true, version: 1 })).toBe(only);
  });

  it("marks the reply, not the reviewer's verdict that came after it", () => {
    const withVerdict = markVerdicts([agent("a1", "Done."), agent("a2", PASS)]);
    const marked = markHandIn(withVerdict, { reviewPending: true, version: 1 });
    expect(marked[0].kind).toBe("handed-in");
    expect(marked[1].kind).toBe("verdict");
  });
});

describe("buildThreadItems", () => {
  it("clusters the machinery and keeps the talk", () => {
    const items = buildThreadItems({
      activity: [agent("a1", "Hello."), system("s1"), system("s2"), human("h1")],
    });
    expect(items.map((item) => item.kind)).toEqual(["agent", "cluster", "human"]);
    expect(items[1].items).toHaveLength(2);
  });

  it("puts a verdict, a hand-in and a cluster in one thread", () => {
    const items = buildThreadItems({
      activity: [agent("a1", "Done."), system("s1"), system("s2"), agent("a2", FAIL)],
      reviewPending: true,
      handedInVersion: 3,
    });
    expect(items.map((item) => item.kind)).toEqual(["handed-in", "cluster", "verdict"]);
    expect(items[0].version).toBe(3);
  });

  it("leaves an empty thread empty", () => {
    expect(buildThreadItems({ activity: [] })).toEqual([]);
  });
});

describe("lastVerdict", () => {
  it("is null when the reviewer has not spoken", () => {
    expect(lastVerdict(buildThreadItems({ activity: [agent("a", "Done.")] }))).toBeNull();
  });

  it("is the most recent one when it has spoken twice", () => {
    const items = buildThreadItems({ activity: [agent("a1", FAIL), agent("a2", PASS)] });
    expect(lastVerdict(items)?.verdict?.verdict).toBe("pass");
  });
});
