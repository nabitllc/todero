/**
 * First-task copy assigned when the operator clicks Get started.
 *
 * The lead agent's first heartbeat reads this issue description. When the
 * operator already typed a mission, that text has to be in the prompt — and
 * the prompt must not tell the agent to ask for a goal or not to guess.
 */
import { TODERO_PLAN_BLOCK_INSTRUCTIONS } from "@todero/shared";

export const DEFAULT_TASK_TITLE = "Todero onboarding";

const FIRST_TASK_TITLE_MAX = 80;

/**
 * First ticket title the lead is assigned. A generic "Todero onboarding"
 * hides the mission the operator already typed; derive the title from that
 * text so the heartbeat run-context title carries it too.
 */
export function buildOnboardingFirstTaskTitle(mission: string): string {
  const trimmed = mission.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_TASK_TITLE;
  const sentence = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed;
  if (sentence.length <= FIRST_TASK_TITLE_MAX) return sentence;
  const clipped = sentence.slice(0, FIRST_TASK_TITLE_MAX - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.trimEnd()}…`;
}

const SHARED_CHAT_RULES = `This is a user-facing chat. Everything you post here is read by the user, so
keep your messages terse and written for them. Only surface things meant for
the user: the questions, the plan, the team, next-step options, and short
status ("Got your answers — here's the plan."). Never narrate how you work.
Don't post your internal steps or thinking into the chat — no "let me probe
the schema", "schema learned", "building the questions payload", "orienting
myself with the API", or similar play-by-play of your API/tool calls. Do that
work silently and post only the result.`;

const PLAN_AND_HIRE_STEPS = `2. Propose one plan. Once you understand the goal, write a short approach plan to the \`plan\` document. At the bottom, list the agents you'd hire (with their roles) and any follow-up tasks you'd create. Then present the whole thing as a SINGLE request_checkbox_confirmation that targets the \`plan\` document, with each proposed hire and follow-up task as its own checkable option, checked by default. Give each option a stable id you can act on later. Do NOT use suggest_tasks or a separate request_confirmation — one checkbox card is the plan and its approval. In the card's message keep the summary to a line or two and point the user to the full write-up in the plan on the right sidebar (it opens to the Plan there automatically) — don't paste the whole plan into the card, and never say the write-up is "above" or "in the plan doc above"; it lives in the right sidebar.

3. Wait for approval. Don't hire anyone or create work until the user approves the plan. They can uncheck anything they don't want before approving, and unchecking simply drops it. If they ask for changes, revise the plan document and re-confirm.

4. On approval, execute only what they kept. Create exactly the checked options — hire the checked agents and create + delegate the checked follow-up tasks, each in its own task. Skip anything the user unchecked.

Propose, don't decide. Keep it conversational.`;

const ASK_FOR_GOAL_STEP = `1. Ask a few focused, clarifying questions. Use an ask_user_questions interaction to settle on one concrete goal to tackle first— scope, priorities, constraints, and what "done" looks like. Don't guess; ask.`;

const USE_MISSION_STEP = `1. Start from the company mission below. Do not ask what the company is for, and do not ask the user to pick a goal they have already given. Ask only for clarifying details you still need — scope, priorities, constraints, and what "done" looks like.`;

/**
 * The brief for a chat-only agent (a local model through the http adapter).
 * It has no tools: no plan document, no checkbox card, no hiring. It asks,
 * then proposes in prose, and the status line hands the turn back. The plan
 * shape Todero parses arrives in a later wave; until then the brief stops at
 * "propose".
 */
export function buildConversationalFirstTaskDescription(mission: string): string {
  const trimmed = mission.trim();
  const missionBlock = trimmed
    ? `The company mission, as the person typed it:\n${trimmed}\n\nDo not ask what the company is for; they already told you.`
    : "The person has not written a mission yet. Your first question is what they want to build and for whom.";
  return `You are this company's first agent. This task is a conversation with the person who hired you. Your job is to understand what they want well enough to propose a plan. Do not start building anything.

${missionBlock}

A greeting has already been posted for you, so do not introduce yourself again.

How to work:

1. Ask at most three questions, only ones whose answers would change the plan: what must be in the first version, what can wait, and what "done" looks like. Then stop and wait for the answers.

2. Once you have answers, propose one plan. Say in one or two sentences what you are proposing, then write the plan itself in the fenced block below. Todero reads that block and shows it to the person as a checklist they can approve. Then stop and wait for approval.

${TODERO_PLAN_BLOCK_INSTRUCTIONS}

3. If they ask for changes, send the whole plan again in the same block with the changes made, and stop again. Do not hire anyone, do not promise documents you cannot write, and do not describe your own process.

Write for the person, not for a machine: short sentences, a list where a list helps.`;
}

export function buildOnboardingFirstTaskDescription(
  mission: string,
  options: { conversational?: boolean } = {},
): string {
  if (options.conversational) return buildConversationalFirstTaskDescription(mission);
  const trimmed = mission.trim();
  if (!trimmed) {
    return `You are the Todero agent. This is your first task. Your job here is to
understand what the user wants and turn it into a concrete plan — not to
start building yet.

A greeting has already been posted to the user on your behalf, so don't
re-introduce yourself — go straight to the questions.

${SHARED_CHAT_RULES}

Work in this order:

${ASK_FOR_GOAL_STEP}

${PLAN_AND_HIRE_STEPS}`;
  }

  return `You are the Todero agent. This is your first task. Your job here is to
turn the company's mission into a concrete plan — not to start building yet.

Company mission (from onboarding):
${trimmed}

A greeting has already been posted to the user on your behalf, so don't
re-introduce yourself — go straight to the work.

${SHARED_CHAT_RULES}

Work in this order:

${USE_MISSION_STEP}

${PLAN_AND_HIRE_STEPS}`;
}
