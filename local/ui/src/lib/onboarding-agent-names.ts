/**
 * Names the onboarding wizard can fill when someone asks it to recommend
 * one. Roles and first names, nothing branded: the field is a person, not a
 * product mascot.
 */
export const RECOMMENDED_AGENT_NAMES = [
  "Chief of staff",
  "Designer",
  "Ron",
  "Ada",
  "Maya",
  "Sam",
  "Ops Lead",
  "Researcher",
  "Writer",
  "Alex",
] as const;

export type RecommendedAgentName = (typeof RECOMMENDED_AGENT_NAMES)[number];

/**
 * Pick a name from the local list. A later click should not immediately
 * repeat whatever is already in the field when the list has another option.
 */
export function pickRecommendedAgentName(currentName: string): RecommendedAgentName {
  const current = currentName.trim();
  const others = RECOMMENDED_AGENT_NAMES.filter((name) => name !== current);
  const pool = others.length > 0 ? others : [...RECOMMENDED_AGENT_NAMES];
  return pool[Math.floor(Math.random() * pool.length)]!;
}
