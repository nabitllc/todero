import { describe, expect, it } from "vitest";
import { rehypeMentions, splitMentions } from "./work-item-mentions";

describe("splitMentions", () => {
  it("leaves text with no mention in one piece", () => {
    expect(splitMentions("hello there")).toEqual([{ text: "hello there", mention: false }]);
  });

  it("pulls a mention out of the middle", () => {
    expect(splitMentions("ask @Nova about it")).toEqual([
      { text: "ask ", mention: false },
      { text: "@Nova", mention: true },
      { text: " about it", mention: false },
    ]);
  });

  it("handles a mention at each end", () => {
    expect(splitMentions("@Nova and @Ada")).toEqual([
      { text: "@Nova", mention: true },
      { text: " and ", mention: false },
      { text: "@Ada", mention: true },
    ]);
  });

  it("is not confused by a bare at sign", () => {
    expect(splitMentions("email me @ work")).toEqual([{ text: "email me @ work", mention: false }]);
  });
});

describe("rehypeMentions", () => {
  it("wraps a mention in the span the stylesheet knows", () => {
    const tree = {
      type: "root",
      children: [
        { type: "element", tagName: "p", children: [{ type: "text", value: "hi @Nova" }] },
      ],
    };
    rehypeMentions()(tree as never);
    const paragraph = (tree.children[0] as { children: unknown[] }).children;
    expect(paragraph).toHaveLength(2);
    expect(paragraph[1]).toMatchObject({
      tagName: "span",
      properties: { className: ["work-item-mention"] },
    });
  });

  it("leaves code alone: an @ there is literal", () => {
    const tree = {
      type: "root",
      children: [
        { type: "element", tagName: "code", children: [{ type: "text", value: "npm i @todero/ui" }] },
      ],
    };
    rehypeMentions()(tree as never);
    expect((tree.children[0] as { children: unknown[] }).children).toEqual([
      { type: "text", value: "npm i @todero/ui" },
    ]);
  });

  it("reaches a mention nested inside bold text in a list", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "li",
          children: [
            { type: "element", tagName: "strong", children: [{ type: "text", value: "@Ada" }] },
          ],
        },
      ],
    };
    rehypeMentions()(tree as never);
    const strong = (tree.children[0] as { children: Array<{ children: unknown[] }> }).children[0];
    expect(strong.children[0]).toMatchObject({ tagName: "span" });
  });
});
