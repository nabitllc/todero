import { describe, expect, it } from "vitest";
import {
  parseManagerSendbackGuidance,
  descriptionWithGuidanceMarker,
  hasGuidanceMarker,
  descriptionWithWaitingForManagerMarker,
  isWaitingForManagerSendback,
  descriptionWithoutWaitingForManagerMarker,
} from "./manager-sendback.js";

describe("manager-sendback", () => {
  describe("parseManagerSendbackGuidance", () => {
    it("extracts guidance paragraph before STATUS", () => {
      const reply = `The task needs to be clearer.
It should explain step 3 better.

STATUS: waiting`;
      const guidance = parseManagerSendbackGuidance(reply);
      expect(guidance).toBe("The task needs to be clearer. It should explain step 3 better.");
    });

    it("stops at assignments block", () => {
      const reply = `Rewrite the brief to include pricing.

\`\`\`
assignments:
- Task: Alice
\`\`\`

STATUS: waiting`;
      const guidance = parseManagerSendbackGuidance(reply);
      expect(guidance).toContain("Rewrite the brief");
      expect(guidance).not.toContain("assignments");
    });

    it("handles single-line guidance", () => {
      const reply = "Make it shorter.\n\nSTATUS: waiting";
      const guidance = parseManagerSendbackGuidance(reply);
      expect(guidance).toBe("Make it shorter.");
    });

    it("handles empty reply", () => {
      const guidance = parseManagerSendbackGuidance("");
      expect(guidance).toBe("");
    });

    it("stops at first blank line", () => {
      const reply = `First paragraph about the changes.

Second paragraph (should not be included)
STATUS: waiting`;
      const guidance = parseManagerSendbackGuidance(reply);
      expect(guidance).toBe("First paragraph about the changes.");
    });
  });

  describe("guidance marker", () => {
    it("adds guidance marker to description", () => {
      const marked = descriptionWithGuidanceMarker("Original description");
      expect(marked).toContain("Original description");
      expect(marked).toContain("todero-has-guidance");
    });

    it("checks for guidance marker", () => {
      const marked = descriptionWithGuidanceMarker("Text");
      expect(hasGuidanceMarker(marked)).toBe(true);
      expect(hasGuidanceMarker("Text without marker")).toBe(false);
      expect(hasGuidanceMarker(null)).toBe(false);
    });

    it("keeps only one guidance marker", () => {
      const marked1 = descriptionWithGuidanceMarker("Text");
      const marked2 = descriptionWithGuidanceMarker(marked1);
      const markerCount = (marked2.match(/todero-has-guidance/g) || []).length;
      expect(markerCount).toBe(1);
    });
  });

  describe("waiting for manager marker", () => {
    it("adds waiting marker to description", () => {
      const marked = descriptionWithWaitingForManagerMarker("Original");
      expect(marked).toContain("Original");
      expect(marked).toContain("todero-waiting-for-manager-sendback");
    });

    it("checks for waiting marker", () => {
      const marked = descriptionWithWaitingForManagerMarker("Text");
      expect(isWaitingForManagerSendback(marked)).toBe(true);
      expect(isWaitingForManagerSendback("Text without marker")).toBe(false);
      expect(isWaitingForManagerSendback(null)).toBe(false);
    });

    it("removes waiting marker", () => {
      const marked = descriptionWithWaitingForManagerMarker("Text");
      const cleaned = descriptionWithoutWaitingForManagerMarker(marked);
      expect(cleaned).toBe("Text");
      expect(isWaitingForManagerSendback(cleaned)).toBe(false);
    });

    it("keeps only one waiting marker", () => {
      const marked1 = descriptionWithWaitingForManagerMarker("Text");
      const marked2 = descriptionWithWaitingForManagerMarker(marked1);
      const markerCount = (marked2.match(/todero-waiting-for-manager-sendback/g) || []).length;
      expect(markerCount).toBe(1);
    });
  });
});
