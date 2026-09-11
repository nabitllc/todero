import { describe, expect, it } from "vitest";
import type { DocumentRevision, IssueDocument } from "@todero/shared";
import { deliverableVersions, handedInAt, versionLabel } from "./work-item-deliverable";

const NOW = new Date("2026-09-11T14:00:00Z");

const doc = {
  body: "The draft.",
  latestRevisionNumber: 2,
  updatedAt: new Date("2026-09-11T10:42:00Z"),
} as unknown as IssueDocument;

const revision = (number: number, at: string, body: string): DocumentRevision =>
  ({ id: `r${number}`, revisionNumber: number, body, createdAt: new Date(at) }) as unknown as DocumentRevision;

describe("deliverableVersions", () => {
  it("falls back to the document itself when no revisions came back", () => {
    const versions = deliverableVersions(doc, []);
    expect(versions).toHaveLength(1);
    expect(versions[0].number).toBe(2);
    expect(versions[0].body).toBe("The draft.");
  });

  it("counts an unversioned document as version one", () => {
    const versions = deliverableVersions({ ...doc, latestRevisionNumber: 0 }, []);
    expect(versions[0].number).toBe(1);
  });

  it("puts the newest revision first", () => {
    const versions = deliverableVersions(doc, [
      revision(1, "2026-09-10T09:00:00Z", "First."),
      revision(2, "2026-09-11T10:42:00Z", "Second."),
    ]);
    expect(versions.map((version) => version.number)).toEqual([2, 1]);
    expect(versions[0].body).toBe("Second.");
  });
});

describe("handedInAt", () => {
  it("is empty when the turn recorded no time", () => {
    expect(handedInAt(null, NOW)).toBe("");
    expect(handedInAt("not a date", NOW)).toBe("");
  });

  it("says only the time for something handed in today", () => {
    const label = handedInAt(new Date("2026-09-11T10:42:00Z"), NOW);
    expect(label).not.toContain("Sep");
    expect(label.length).toBeGreaterThan(0);
  });

  it("says the day too for anything older", () => {
    expect(handedInAt(new Date("2026-09-09T10:42:00Z"), NOW)).toContain("Sep");
  });
});

describe("versionLabel", () => {
  const version = { number: 2, body: "x", at: new Date("2026-09-11T10:42:00Z") };

  it("leads with the version", () => {
    expect(versionLabel(version, {}, NOW).startsWith("Version 2 · handed in ")).toBe(true);
  });

  it("says accepted only on the newest version of finished work", () => {
    expect(versionLabel(version, { latest: true, accepted: true }, NOW)).toContain("accepted");
    expect(versionLabel(version, { latest: false, accepted: true }, NOW)).not.toContain("accepted");
  });

  it("never says accepted while the person still has to decide", () => {
    expect(
      versionLabel(version, { latest: true, accepted: true, reviewPending: true }, NOW),
    ).not.toContain("accepted");
  });

  it("drops the time rather than showing an empty piece of the line", () => {
    expect(versionLabel({ number: 1, body: "x", at: null }, {}, NOW)).toBe("Version 1");
  });
});
