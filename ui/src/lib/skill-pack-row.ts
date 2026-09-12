/**
 * Extract and format skill pack metadata for display in the UI.
 * Works with any skill row that has metadata, checking if it belongs to the pack.
 */

import { isSkillPackSkill } from "@todero/shared";

export interface SkillPackRowFacts {
  /** True when the skill is part of the pack (has todero-task-kinds metadata). */
  isPack: boolean;
  /** The version number as a string, or null if not a pack skill. */
  version: string | null;
  /** The "last changed because" message, or null if not a pack skill. */
  lastChangedBecause: string | null;
}

/**
 * Extract version and metadata facts for a skill row to display in the pack view.
 * Returns null values for non-pack skills.
 */
export function packRowFacts(item: {
  metadata: Record<string, unknown> | null;
}): SkillPackRowFacts {
  if (!isSkillPackSkill(item.metadata)) {
    return {
      isPack: false,
      version: null,
      lastChangedBecause: null,
    };
  }

  const metadata = item.metadata as Record<string, unknown>;
  const version = metadata.version;
  const versionString = version != null ? String(version) : null;
  const lastChangedBecause = metadata.last_changed_because;
  const lastChangedBecauseString = typeof lastChangedBecause === "string" ? lastChangedBecause : null;

  return {
    isPack: true,
    version: versionString,
    lastChangedBecause: lastChangedBecauseString,
  };
}
