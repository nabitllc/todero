import { describe, expect, it } from "vitest";
import type { CompanySkill } from "@todero/shared";
import { isSkillPackSkill, parseSkillPackKinds } from "@todero/shared";
import {
  SKILL_PACK_DEFAULT_PRIORITY,
  SKILL_PACK_HEADING,
  buildSkillPackText,
  loadAgentSkillText,
  readSkillPackFacts,
  skillBodyForModel,
  skillPackAppliesToKind,
  skillPackCeilingForContext,
  toSkillPackEntries,
  type SkillPackEntry,
} from "./skill-pack.js";

function entry(
  name: string,
  kinds: "all" | string[],
  priority: number,
  body = `Body of ${name}.`,
): SkillPackEntry {
  return { key: `company/c1/${name}`, name, facts: { kinds, priority }, body };
}

function skillRow(overrides: Partial<CompanySkill> & Pick<CompanySkill, "key" | "name">): CompanySkill {
  return {
    id: overrides.key,
    companyId: "c1",
    slug: overrides.name,
    description: null,
    markdown: "",
    sourceType: "local_path",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [],
    iconUrl: null,
    color: null,
    tagline: null,
    authorName: null,
    homepageUrl: null,
    categories: [],
    sharingScope: "company",
    publicShareToken: null,
    forkedFromSkillId: null,
    forkedFromCompanyId: null,
    starCount: 0,
    installCount: 0,
    forkCount: 0,
    currentVersionId: null,
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as CompanySkill;
}

describe("parseSkillPackKinds", () => {
  it("reads a real array", () => {
    expect(parseSkillPackKinds(["planning", "drafting"])).toEqual(["planning", "drafting"]);
  });

  it("reads the flow-list string the frontmatter parser hands back", () => {
    expect(parseSkillPackKinds("[planning, drafting]")).toEqual(["planning", "drafting"]);
  });

  it("reads a comma-separated string", () => {
    expect(parseSkillPackKinds("planning, drafting")).toEqual(["planning", "drafting"]);
  });

  it("reads a single kind", () => {
    expect(parseSkillPackKinds("judging")).toEqual(["judging"]);
  });

  it("reads 'all' in either shape", () => {
    expect(parseSkillPackKinds("all")).toBe("all");
    expect(parseSkillPackKinds("[all]")).toBe("all");
    expect(parseSkillPackKinds(["all"])).toBe("all");
  });

  it("lower-cases and de-duplicates", () => {
    expect(parseSkillPackKinds("[Planning, planning, DRAFTING]")).toEqual(["planning", "drafting"]);
  });

  it("returns null for anything that names no kind", () => {
    expect(parseSkillPackKinds(undefined)).toBeNull();
    expect(parseSkillPackKinds(null)).toBeNull();
    expect(parseSkillPackKinds(7)).toBeNull();
    expect(parseSkillPackKinds("")).toBeNull();
    expect(parseSkillPackKinds("[]")).toBeNull();
    expect(parseSkillPackKinds([])).toBeNull();
  });
});

describe("readSkillPackFacts", () => {
  it("reads the kinds and the priority", () => {
    expect(readSkillPackFacts({ "todero-task-kinds": "[planning]", "todero-priority": 1 }))
      .toEqual({ kinds: ["planning"], priority: 1 });
  });

  it("accepts a priority written as a string", () => {
    expect(readSkillPackFacts({ "todero-task-kinds": "all", "todero-priority": "2" }))
      .toEqual({ kinds: "all", priority: 2 });
  });

  it("sorts a skill with no priority last", () => {
    expect(readSkillPackFacts({ "todero-task-kinds": "all" })?.priority).toBe(SKILL_PACK_DEFAULT_PRIORITY);
  });

  it("returns null for a skill outside the pack", () => {
    expect(readSkillPackFacts({ version: 1 })).toBeNull();
    expect(readSkillPackFacts(null)).toBeNull();
    expect(readSkillPackFacts("nope")).toBeNull();
  });
});

describe("isSkillPackSkill", () => {
  it("is true only for a skill that names the turns it applies to", () => {
    expect(isSkillPackSkill({ "todero-task-kinds": "all" })).toBe(true);
    expect(isSkillPackSkill({ sourceKind: "paperclip_bundled" })).toBe(false);
  });
});

describe("skillPackAppliesToKind", () => {
  it("matches a named kind", () => {
    expect(skillPackAppliesToKind({ kinds: ["planning"], priority: 1 }, "planning")).toBe(true);
    expect(skillPackAppliesToKind({ kinds: ["planning"], priority: 1 }, "drafting")).toBe(false);
  });

  it("matches every kind for 'all'", () => {
    expect(skillPackAppliesToKind({ kinds: "all", priority: 1 }, "wrap-up")).toBe(true);
    expect(skillPackAppliesToKind({ kinds: "all", priority: 1 }, "planning")).toBe(true);
    expect(skillPackAppliesToKind({ kinds: "all", priority: 1 }, "drafting")).toBe(true);
  });

  it("leaves the reviewer out of 'all': only a skill that names judging reaches it", () => {
    expect(skillPackAppliesToKind({ kinds: "all", priority: 1 }, "judging")).toBe(false);
    expect(skillPackAppliesToKind({ kinds: ["judging"], priority: 1 }, "judging")).toBe(true);
  });

  it("ignores case and surrounding space in the asked-for kind", () => {
    expect(skillPackAppliesToKind({ kinds: ["judging"], priority: 1 }, " Judging ")).toBe(true);
  });
});

describe("toSkillPackEntries", () => {
  it("keeps only pack rows, strips their frontmatter and sorts by priority", () => {
    const entries = toSkillPackEntries([
      skillRow({
        key: "company/c1/b",
        name: "b",
        metadata: { "todero-task-kinds": "all", "todero-priority": 3 },
        markdown: "---\nname: b\n---\n\nB body.\n",
      }),
      skillRow({
        key: "company/c1/a",
        name: "a",
        metadata: { "todero-task-kinds": "all", "todero-priority": 1 },
        markdown: "---\nname: a\n---\n\nA body.\n",
      }),
      skillRow({ key: "nabitllc/todero/todero", name: "todero", markdown: "Command-line skill." }),
    ]);
    expect(entries.map((item) => item.name)).toEqual(["a", "b"]);
    expect(entries[0]!.body).toBe("A body.");
  });

  it("breaks a priority tie by name so two turns read the same thing", () => {
    const entries = toSkillPackEntries([
      skillRow({ key: "company/c1/z", name: "z", metadata: { "todero-task-kinds": "all", "todero-priority": 1 }, markdown: "Z." }),
      skillRow({ key: "company/c1/m", name: "m", metadata: { "todero-task-kinds": "all", "todero-priority": 1 }, markdown: "M." }),
    ]);
    expect(entries.map((item) => item.name)).toEqual(["m", "z"]);
  });

  it("skips a pack row with an empty body", () => {
    expect(toSkillPackEntries([
      skillRow({ key: "company/c1/a", name: "a", metadata: { "todero-task-kinds": "all" }, markdown: "---\nname: a\n---\n\n" }),
    ])).toEqual([]);
  });
});

describe("buildSkillPackText", () => {
  it("returns nothing when no skill applies to the kind", () => {
    expect(buildSkillPackText([entry("plan", ["planning"], 1)], "judging"))
      .toEqual({ text: "", dropped: [], included: [] });
  });

  it("opens with the heading and keeps the priority order", () => {
    const built = buildSkillPackText(
      [entry("first", ["planning"], 1), entry("second", "all", 2)],
      "planning",
    );
    expect(built.included).toEqual(["first", "second"]);
    expect(built.text.startsWith(`${SKILL_PACK_HEADING}\n\n## first`)).toBe(true);
    expect(built.text.indexOf("## first")).toBeLessThan(built.text.indexOf("## second"));
  });

  it("drops the lowest-priority skill when the turn is over the ceiling", () => {
    const built = buildSkillPackText(
      [
        entry("keep", ["planning"], 1, "x".repeat(300)),
        entry("drop", ["planning"], 2, "y".repeat(300)),
      ],
      "planning",
      400,
    );
    expect(built.included).toEqual(["keep"]);
    expect(built.dropped).toEqual(["drop"]);
    expect(built.text).not.toContain("## drop");
  });

  it("drops the lower-priority tail, never a higher-priority skill that is merely longer", () => {
    const built = buildSkillPackText(
      [
        entry("first", ["planning"], 1, "x".repeat(200)),
        entry("long-and-important", ["planning"], 2, "y".repeat(5_000)),
        entry("short-and-not", ["planning"], 3, "z"),
      ],
      "planning",
      400,
    );
    expect(built.included).toEqual(["first"]);
    expect(built.dropped).toEqual(["long-and-important", "short-and-not"]);
    expect(built.text).not.toContain("## short-and-not");
  });

  it("keeps the highest-priority skill even when it alone is over the ceiling", () => {
    const built = buildSkillPackText([entry("only", ["planning"], 1, "x".repeat(500))], "planning", 100);
    expect(built.included).toEqual(["only"]);
    expect(built.dropped).toEqual([]);
  });

  it("carries the whole pack for a planning turn at the shipped ceiling", () => {
    const built = buildSkillPackText(
      [1, 2, 3, 4, 5, 6].map((n) => entry(`skill-${n}`, ["planning"], n, "x".repeat(3_000))),
      "planning",
    );
    expect(built.dropped).toEqual([]);
    expect(built.included).toHaveLength(6);
  });
});

describe("loadAgentSkillText", () => {
  const skills = [
    skillRow({
      key: "company/c1/plan",
      name: "plan",
      metadata: { "todero-task-kinds": "[planning]", "todero-priority": 1 },
      markdown: "---\nname: plan\n---\n\nHow to plan.\n",
    }),
    skillRow({
      key: "company/c1/tone",
      name: "tone",
      metadata: { "todero-task-kinds": "all", "todero-priority": 1 },
      markdown: "---\nname: tone\n---\n\nHow to talk.\n",
    }),
    skillRow({
      key: "company/c1/review",
      name: "review",
      metadata: { "todero-task-kinds": "[judging]", "todero-priority": 1 },
      markdown: "---\nname: review\n---\n\nHow to review.\n",
    }),
  ];

  const agentWith = (desiredSkills: string[]) => ({
    adapterConfig: { toderoSkillSync: { desiredSkills } },
  });

  it("returns only what is turned on and applies to the kind", () => {
    const built = loadAgentSkillText({
      agent: agentWith(["company/c1/plan", "company/c1/tone", "company/c1/review"]),
      kind: "planning",
      companySkills: skills,
    });
    expect(built.included).toEqual(["plan", "tone"]);
    expect(built.text).toContain("How to plan.");
    expect(built.text).not.toContain("How to review.");
  });

  it("gives the reviewer its own skill and no other", () => {
    // The reviewer is hired with a copy of the lead's settings, so everything
    // the lead has turned on is turned on for it too — the every-turn tone
    // skill included. It still reads one thing.
    const built = loadAgentSkillText({
      agent: agentWith(["company/c1/plan", "company/c1/tone", "company/c1/review"]),
      kind: "judging",
      companySkills: skills,
    });
    expect(built.included).toEqual(["review"]);
    expect(built.text).not.toContain("How to talk.");
  });

  it("returns nothing for an agent with nothing turned on", () => {
    expect(loadAgentSkillText({ agent: agentWith([]), kind: "planning", companySkills: skills }))
      .toEqual({ text: "", dropped: [], included: [] });
    expect(loadAgentSkillText({ agent: { adapterConfig: {} }, kind: "planning", companySkills: skills }))
      .toEqual({ text: "", dropped: [], included: [] });
    expect(loadAgentSkillText({ agent: { adapterConfig: null }, kind: "planning", companySkills: skills }))
      .toEqual({ text: "", dropped: [], included: [] });
  });

  it("returns nothing when what is turned on is not in the pack", () => {
    expect(loadAgentSkillText({
      agent: agentWith(["nabitllc/todero/todero"]),
      kind: "planning",
      companySkills: skills,
    })).toEqual({ text: "", dropped: [], included: [] });
  });
});

describe("skillBodyForModel", () => {
  it("keeps everything before the person-facing notes and drops the notes", () => {
    const body = "# Rules\n\nDo the thing.\n\n## What Todero changed\n\nSources and dropped parts.\n";
    expect(skillBodyForModel(body)).toBe("# Rules\n\nDo the thing.");
  });

  it("leaves a body without notes alone", () => {
    expect(skillBodyForModel("Just rules.\n")).toBe("Just rules.");
  });
});

describe("skillPackCeilingForContext", () => {
  it("sizes the ceiling for the 4,096-token window Ollama serves by default", () => {
    expect(skillPackCeilingForContext(null)).toBe(5734);
    expect(skillPackCeilingForContext(undefined)).toBe(5734);
    expect(skillPackCeilingForContext(4096)).toBe(5734);
  });

  it("grows with the window and never passes the fixed ceiling", () => {
    expect(skillPackCeilingForContext(8192)).toBe(11468);
    expect(skillPackCeilingForContext(32768)).toBe(20_000);
  });

  it("keeps the highest-priority skills and drops the tail on a small window", () => {
    const long = "x".repeat(3_000);
    const entries = [
      entry("todero-plan-a-project", ["planning"], 1, long),
      entry("todero-talk-like-a-colleague", "all", 1, long),
      entry("todero-ask-or-decide", ["planning"], 2, long),
      entry("todero-when-to-hire", ["planning"], 3, long),
    ];
    const text = buildSkillPackText(entries, "planning", skillPackCeilingForContext(4096));
    expect(text.included).toEqual(["todero-plan-a-project"]);
    expect(text.dropped).toEqual(["todero-talk-like-a-colleague", "todero-ask-or-decide", "todero-when-to-hire"]);
    const wide = buildSkillPackText(entries, "planning", skillPackCeilingForContext(32768));
    expect(wide.dropped).toEqual([]);
  });

  it("does not send the notes section to the model", () => {
    const entries = [entry("todero-plan-a-project", ["planning"], 1, "Rules.\n\n## What Todero changed\n\nNotes.")];
    const text = buildSkillPackText(entries, "planning");
    expect(text.text).toContain("Rules.");
    expect(text.text).not.toContain("What Todero changed");
  });
});
