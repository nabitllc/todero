import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  buildManagerAssignmentTurnInstruction,
  descriptionWithManagerAssignmentMarker,
  readManagerAssignmentMarker,
} from "./manager-assignment.js";

describe("buildManagerAssignmentTurnInstruction", () => {
  it("builds an instruction with tasks and workers", () => {
    const tasks = [
      { taskId: "1", taskIdentifier: "ZZW-1", taskTitle: "Draft guide", taskFeature: "Docs" },
      { taskId: "2", taskIdentifier: "ZZW-2", taskTitle: "List prices", taskFeature: "Pricing" },
    ];
    const workers = [
      { id: "w1", name: "Ada", openTaskCount: 2 },
      { id: "w2", name: "Nova", openTaskCount: 1 },
    ];

    const instruction = buildManagerAssignmentTurnInstruction(tasks, workers);

    expect(instruction).toContain("Draft guide");
    expect(instruction).toContain("(ZZW-1)");
    expect(instruction).toContain("Feature: Docs");
    expect(instruction).toContain("Ada: 2 open tasks");
    expect(instruction).toContain("Nova: 1 open task");
    expect(instruction).toContain("assignments:");
  });
});

describe("Manager assignment markers", () => {
  const managerId = randomUUID();

  describe("descriptionWithManagerAssignmentMarker", () => {
    it("adds marker to empty description", () => {
      const result = descriptionWithManagerAssignmentMarker(null, managerId);
      expect(result).toContain(`todero-assigned-by: ${managerId}`);
    });

    it("appends marker to existing description", () => {
      const desc = "Do the thing.";
      const result = descriptionWithManagerAssignmentMarker(desc, managerId);
      expect(result).toContain(desc);
      expect(result).toContain(`todero-assigned-by: ${managerId}`);
    });

    it("keeps exactly one marker after multiple calls", () => {
      const desc = "Do the thing.";
      const once = descriptionWithManagerAssignmentMarker(desc, managerId);
      const twice = descriptionWithManagerAssignmentMarker(once, managerId);
      const count = (twice.match(/todero-assigned-by/g) || []).length;
      expect(count).toBe(1);
      expect(twice).toContain(desc);
    });

    it("preserves original description when replacing marker", () => {
      const oldManagerId = randomUUID();
      const newManagerId = randomUUID();
      const desc = "Original task description";
      const withOldMarker = descriptionWithManagerAssignmentMarker(desc, oldManagerId);
      const withNewMarker = descriptionWithManagerAssignmentMarker(withOldMarker, newManagerId);

      expect(withNewMarker).toContain(desc);
      expect(withNewMarker).toContain(`todero-assigned-by: ${newManagerId}`);
      expect(withNewMarker).not.toContain(oldManagerId);
    });
  });

  describe("readManagerAssignmentMarker", () => {
    it("reads the manager ID from the marker", () => {
      const desc = descriptionWithManagerAssignmentMarker("Do the thing.", managerId);
      const read = readManagerAssignmentMarker(desc);
      expect(read).toBe(managerId);
    });

    it("returns null when there is no marker", () => {
      const result = readManagerAssignmentMarker("Just a regular description.");
      expect(result).toBeNull();
    });

    it("returns null for empty description", () => {
      expect(readManagerAssignmentMarker(null)).toBeNull();
    });

    it("tolerates whitespace in the marker", () => {
      const desc = `Do the thing.\n<!--  todero-assigned-by: ${managerId}  -->`;
      const read = readManagerAssignmentMarker(desc);
      expect(read).toBe(managerId);
    });
  });
});
