import { describe, expect, it } from "vitest";
import { clusterThread } from "./work-item-cluster";
import type { WorkItemActivityItem } from "./work-item-model";

describe("clusterThread", () => {
  it("leaves empty arrays empty", () => {
    expect(clusterThread([])).toEqual([]);
  });

  it("leaves single items unchanged", () => {
    const item: WorkItemActivityItem = { id: "1", kind: "human", body: "Hello" };
    expect(clusterThread([item])).toEqual([item]);
  });

  it("keeps non-system items separated", () => {
    const items: WorkItemActivityItem[] = [
      { id: "1", kind: "human", body: "Hello" },
      { id: "2", kind: "agent", body: "Hi" },
      { id: "3", kind: "human", body: "How are you?" },
    ];
    expect(clusterThread(items)).toEqual(items);
  });

  it("does not cluster a single system line", () => {
    const items: WorkItemActivityItem[] = [
      { id: "1", kind: "human", body: "Hello" },
      { id: "2", kind: "system", text: "Moved to To do" },
      { id: "3", kind: "human", body: "Great!" },
    ];
    expect(clusterThread(items)).toEqual(items);
  });

  it("clusters consecutive system lines", () => {
    const items: WorkItemActivityItem[] = [
      { id: "1", kind: "human", body: "Hello" },
      { id: "2", kind: "system", text: "Moved to To do" },
      { id: "3", kind: "system", text: "Assigned to Nova" },
      { id: "4", kind: "agent", body: "Starting work" },
    ];
    const result = clusterThread(items);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual(items[0]);
    expect(result[1]?.kind).toBe("cluster");
    expect(result[1]?.items).toHaveLength(2);
    expect(result[2]).toEqual(items[3]);
  });

  it("includes both agent-overflow and system items in clusters", () => {
    const items: WorkItemActivityItem[] = [
      { id: "1", kind: "system", text: "Moved to To do" },
      { id: "2", kind: "agent-overflow", text: "Summary was too long" },
      { id: "3", kind: "system", text: "Assigned to Nova" },
      { id: "4", kind: "human", body: "Nice!" },
    ];
    const result = clusterThread(items);
    expect(result.length).toBe(2);
    expect(result[0]?.kind).toBe("cluster");
    expect(result[0]?.items).toHaveLength(3);
    expect(result[1]).toEqual(items[3]);
  });

  it("creates multiple clusters when separated by non-system items", () => {
    const items: WorkItemActivityItem[] = [
      { id: "1", kind: "system", text: "Moved to To do" },
      { id: "2", kind: "system", text: "Assigned to Nova" },
      { id: "3", kind: "human", body: "Good" },
      { id: "4", kind: "system", text: "Moved to In progress" },
      { id: "5", kind: "agent", body: "Done!" },
    ];
    const result = clusterThread(items);
    expect(result.length).toBe(4);
    expect(result[0]?.kind).toBe("cluster");
    expect(result[0]?.items).toHaveLength(2);
    expect(result[1]?.kind).toBe("human");
    expect(result[2]?.kind).toBe("system");
    expect(result[3]?.kind).toBe("agent");
  });

  it("clusters at the end of the array", () => {
    const items: WorkItemActivityItem[] = [
      { id: "1", kind: "human", body: "Hello" },
      { id: "2", kind: "system", text: "Moved to To do" },
      { id: "3", kind: "system", text: "Assigned to Nova" },
    ];
    const result = clusterThread(items);
    expect(result.length).toBe(2);
    expect(result[1]?.kind).toBe("cluster");
    expect(result[1]?.items).toHaveLength(2);
  });

  it("clusters at the beginning of the array", () => {
    const items: WorkItemActivityItem[] = [
      { id: "1", kind: "system", text: "Created" },
      { id: "2", kind: "system", text: "Assigned to Nova" },
      { id: "3", kind: "human", body: "Hello" },
    ];
    const result = clusterThread(items);
    expect(result.length).toBe(2);
    expect(result[0]?.kind).toBe("cluster");
    expect(result[0]?.items).toHaveLength(2);
    expect(result[1]).toEqual(items[2]);
  });
});
