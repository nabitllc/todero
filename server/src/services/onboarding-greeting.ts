// Deterministic, template-driven greeting seeded as an agent-authored comment on
// the onboarding first task. No LLM call: it lets the user land on a waiting
// teammate instead of a right-aligned "user" bubble showing the agent's own
// seeded instructions.
//
// It deliberately does not quote the mission back: the title already carries
// it, the task brief carries it, and the agent's first real reply works from
// it. Repeating it a third time before the model has said anything reads as
// padding.

export const ONBOARDING_GREETING_AUTHORIZATION_REASON = "onboarding first-task greeting";

export function buildOnboardingGreeting(input: {
  agentName?: string | null;
  teamName?: string | null;
  goals?: string | null;
}): string {
  const agentName = input.agentName?.trim();
  const identity = agentName
    ? `Welcome! I'm ${agentName}, your first agent teammate on Todero.`
    : "Welcome! I'm your first agent teammate on Todero.";
  return `${identity} Give me a moment to read the mission and I'll come back with a couple of questions.`;
}
