/**
 * The plan block: the one fixed shape a chat-only agent writes so Todero can
 * turn a proposal into tasks. The model proposes in this shape; Todero parses
 * it, stores it as the issue's `plan` document, shows it as a card, and on
 * approval creates the tasks itself. The model never needs a tool.
 *
 * Tolerant on purpose. A 7B model gets the shape mostly right; the parser
 * accepts `-` or `*` bullets, `done_when` / `done when` / `done-when`, quoted
 * or bare values, and ignores keys it does not know. It never throws.
 */
export const TODERO_PLAN_FENCE = "todero-plan";

export type ToderoPlanFeature = {
  id: string;
  name: string;
  why: string;
  doneWhen: string;
};

export type ToderoPlanTask = {
  id: string;
  title: string;
  feature: string;
  output: string;
  /**
   * Optional. The task (or tasks, comma separated) that must finish first,
   * named by title or by plan id. Empty means "no stated order": the task
   * then waits only for the task before it inside its own feature, so the
   * first task of every feature can start at the same time.
   */
  after: string;
};

export type ToderoPlan = {
  goal: string;
  features: ToderoPlanFeature[];
  tasks: ToderoPlanTask[];
};

export const TODERO_PLAN_MAX_FEATURES = 12;
export const TODERO_PLAN_MAX_TASKS = 25;

export const TODERO_PLAN_BLOCK_INSTRUCTIONS = `Write the plan inside one fenced block, exactly in this shape and nothing else inside it:

\`\`\`${TODERO_PLAN_FENCE}
goal: One sentence: what we are building and for whom.
features:
  - name: Short feature name
    why: One line on why it matters
    done_when: One line that says how we know it is finished
tasks:
  - title: An imperative task title
    feature: The feature name it belongs to
    output: What you will hand in for it (a document, a list, a draft, a decision)
    after: The title of the task that has to finish first (leave this line out when nothing has to come first)
\`\`\`

Three to seven features. Four to twelve tasks, each naming one of the features. Use \`after\` only when a task truly cannot start until another one is handed in — tasks without it run side by side with the other features. Put any words for the person before the block, not inside it.`;

type Section = "none" | "features" | "tasks";

const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)\s*$/;
const KEY_LINE_RE = /^\s*(?:[-*]\s+)?([A-Za-z][A-Za-z _-]*?)\s*:\s*(.*)$/;

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** The keys a model reaches for when it means "this one comes first". */
function isAfterKey(key: string): boolean {
  return (
    key === "after" ||
    key === "after_task" ||
    key === "depends_on" ||
    key === "dependson" ||
    key === "blocked_by" ||
    key === "requires"
  );
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(["'])(.*)\1$/);
  return (match ? match[2]! : trimmed).trim();
}

function findPlanFence(text: string): { start: number; end: number; inner: string } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i]!.match(FENCE_OPEN_RE);
    if (!open) continue;
    const label = open[2]!.toLowerCase();
    const marker = open[1]![0]!;
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[j]!)) j += 1;
    const inner = lines.slice(i + 1, j).join("\n");
    const looksLikePlan = label === TODERO_PLAN_FENCE || (label === "" && /^\s*goal\s*:/im.test(inner));
    if (!looksLikePlan) {
      i = j;
      continue;
    }
    const before = lines.slice(0, i).join("\n");
    const after = lines.slice(Math.min(j + 1, lines.length)).join("\n");
    return { start: before.length, end: before.length + (text.length - before.length - after.length), inner };
  }
  // No fence at all, but the shape is there: a `goal:` line followed later by
  // a `tasks:` line. Small models drop the fence more often than the keys.
  const goalIndex = lines.findIndex((line) => /^\s*goal\s*:/i.test(line));
  if (goalIndex === -1) return null;
  const tasksIndex = lines.findIndex((line, index) => index > goalIndex && /^\s*tasks\s*:/i.test(line));
  if (tasksIndex === -1) return null;
  // The block runs from `goal:` to the last line that still looks like part of
  // it (a key, a bullet, or an indented continuation).
  let end = tasksIndex;
  for (let k = tasksIndex + 1; k < lines.length; k += 1) {
    const line = lines[k]!;
    if (!line.trim()) {
      end = k;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s+\S/.test(line) || /^\s*[A-Za-z][A-Za-z _-]*\s*:/.test(line)) {
      end = k;
      continue;
    }
    break;
  }
  const before = lines.slice(0, goalIndex).join("\n");
  const block = lines.slice(goalIndex, end + 1).join("\n");
  const start = before.length;
  return { start, end: start + block.length + (goalIndex > 0 ? 1 : 0), inner: block };
}

function parsePlanInner(inner: string): ToderoPlan | null {
  let goal = "";
  let section: Section = "none";
  const features: ToderoPlanFeature[] = [];
  const tasks: ToderoPlanTask[] = [];
  // A holder object, not two lets: assignments inside the helper closures
  // would otherwise narrow the locals to null for the loop body.
  const state: { feature: ToderoPlanFeature | null; task: ToderoPlanTask | null } = { feature: null, task: null };
  let lastKey: string | null = null;

  const startFeature = () => {
    state.feature = { id: `f${features.length + 1}`, name: "", why: "", doneWhen: "" };
    features.push(state.feature);
    state.task = null;
  };
  const startTask = () => {
    state.task = { id: `t${tasks.length + 1}`, title: "", feature: "", output: "", after: "" };
    tasks.push(state.task);
    state.feature = null;
  };

  for (const rawLine of inner.split("\n")) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim()) continue;
    const isItem = /^\s*[-*]\s+/.test(line);
    const keyMatch = line.match(KEY_LINE_RE);

    if (keyMatch) {
      const key = normalizeKey(keyMatch[1]!);
      const value = unquote(keyMatch[2]!);
      if (section === "none" || !isItem) {
        if (key === "goal") {
          goal = value;
          section = "none";
          lastKey = "goal";
          continue;
        }
        if (key === "features" && !isItem) {
          section = "features";
          lastKey = null;
          continue;
        }
        if (key === "tasks" && !isItem) {
          section = "tasks";
          lastKey = null;
          continue;
        }
      }
      if (section === "features") {
        if (isItem) startFeature();
        else if (!state.feature) startFeature();
        const feature = state.feature!;
        if (key === "name" || key === "feature" || key === "title") feature.name = value;
        else if (key === "why" || key === "reason") feature.why = value;
        else if (key === "done_when" || key === "done" || key === "definition_of_done") feature.doneWhen = value;
        lastKey = key;
        continue;
      }
      if (section === "tasks") {
        if (isItem) startTask();
        else if (!state.task) startTask();
        const task = state.task!;
        if (key === "title" || key === "task" || key === "name") task.title = value;
        else if (key === "feature") task.feature = value;
        else if (key === "output" || key === "deliverable" || key === "result") task.output = value;
        else if (isAfterKey(key)) task.after = value;
        lastKey = key;
        continue;
      }
      continue;
    }

    // A bullet with no key: treat it as the item's name or title.
    if (isItem) {
      const value = unquote(line.replace(/^\s*[-*]\s+/, ""));
      if (section === "features") {
        startFeature();
        state.feature!.name = value;
      } else if (section === "tasks") {
        startTask();
        state.task!.title = value;
      }
      lastKey = null;
      continue;
    }

    // Continuation of the previous value (a wrapped line).
    const continuation = line.trim();
    if (lastKey === "goal") goal = `${goal} ${continuation}`.trim();
    else if (state.task && lastKey) {
      if (lastKey === "title" || lastKey === "task" || lastKey === "name") state.task.title += ` ${continuation}`;
      else if (lastKey === "feature") state.task.feature += ` ${continuation}`;
      else if (isAfterKey(lastKey)) state.task.after += ` ${continuation}`;
      else state.task.output += ` ${continuation}`;
    } else if (state.feature && lastKey) {
      if (lastKey === "name" || lastKey === "feature" || lastKey === "title") state.feature.name += ` ${continuation}`;
      else if (lastKey === "why" || lastKey === "reason") state.feature.why += ` ${continuation}`;
      else state.feature.doneWhen += ` ${continuation}`;
    }
  }

  // Values assembled from wrapped lines may still carry the quotes that opened
  // on one line and closed on the next; unquote once everything is joined.
  goal = unquote(goal);
  const cleanFeatures = features
    .map((feature) => ({ ...feature, name: unquote(feature.name), why: unquote(feature.why), doneWhen: unquote(feature.doneWhen) }))
    .filter((feature) => feature.name)
    .slice(0, TODERO_PLAN_MAX_FEATURES)
    .map((feature, index) => ({ ...feature, id: `f${index + 1}` }));
  const cleanTasks = tasks
    .map((task) => ({
      ...task,
      title: unquote(task.title),
      feature: unquote(task.feature),
      output: unquote(task.output),
      after: unquote(task.after ?? ""),
    }))
    .filter((task) => task.title)
    .slice(0, TODERO_PLAN_MAX_TASKS)
    .map((task, index) => ({ ...task, id: `t${index + 1}` }));

  if (!goal.trim() || cleanTasks.length === 0) return null;
  return { goal: goal.trim(), features: cleanFeatures, tasks: cleanTasks };
}

/**
 * Finds the plan block in a reply. `body` is the reply with the block removed,
 * for posting as the comment. Returns null when there is no block or the block
 * has no goal or no tasks: the reply then posts as plain prose.
 */
export function parseToderoPlanBlock(text: string): { plan: ToderoPlan; body: string } | null {
  const fence = findPlanFence(text);
  if (!fence) return null;
  const plan = parsePlanInner(fence.inner);
  if (!plan) return null;
  const body = `${text.slice(0, fence.start)}\n${text.slice(fence.end)}`.replace(/\n{3,}/g, "\n\n").trim();
  return { plan, body };
}

/** The canonical block, as stored in the `plan` document and re-parsed on approval. */
export function formatToderoPlanBlock(plan: ToderoPlan): string {
  const lines: string[] = [`\`\`\`${TODERO_PLAN_FENCE}`, `goal: ${plan.goal}`, "features:"];
  for (const feature of plan.features) {
    lines.push(`  - name: ${feature.name}`);
    if (feature.why) lines.push(`    why: ${feature.why}`);
    if (feature.doneWhen) lines.push(`    done_when: ${feature.doneWhen}`);
  }
  lines.push("tasks:");
  for (const task of plan.tasks) {
    lines.push(`  - title: ${task.title}`);
    if (task.feature) lines.push(`    feature: ${task.feature}`);
    if (task.output) lines.push(`    output: ${task.output}`);
    if (task.after) lines.push(`    after: ${task.after}`);
  }
  lines.push("```");
  return lines.join("\n");
}

/**
 * The type marker Todero writes on every task it creates from an approved
 * plan. The work-item view reads this marker instead of guessing a type from
 * how deep the task sits, so a plan task always reads as a Task even though it
 * hangs under the conversation the plan came from.
 */
export const TODERO_PLAN_TASK_TYPE_MARKER = "<!-- todero-type: Task -->";

/** The description a child task gets, so it stands alone without the parent thread. */
export const TODERO_PLAN_TASK_CONTEXT_MAX_CHARS = 1_500;

export function buildToderoPlanTaskDescription(
  plan: ToderoPlan,
  task: ToderoPlanTask,
  options: {
    /** What the person said in the planning conversation, oldest first. */
    personSaid?: string[];
  } = {},
): string {
  const feature = plan.features.find((row) => row.name.toLowerCase() === task.feature.toLowerCase()) ?? null;
  const parts = [TODERO_PLAN_TASK_TYPE_MARKER, `Goal: ${plan.goal}`];
  const said = (options.personSaid ?? []).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (said.length > 0) {
    let budget = TODERO_PLAN_TASK_CONTEXT_MAX_CHARS;
    const kept: string[] = [];
    for (const line of said.slice().reverse()) {
      if (line.length > budget) break;
      kept.unshift(line);
      budget -= line.length;
    }
    if (kept.length > 0) {
      parts.push("", "What the person said when we planned this (use it; do not ask for it again):", ...kept.map((line) => `- ${line}`), "");
    }
  }
  if (feature) {
    parts.push(`Feature: ${feature.name}${feature.why ? ` — ${feature.why}` : ""}`);
    if (feature.doneWhen) parts.push(`Done when: ${feature.doneWhen}`);
  } else if (task.feature) {
    parts.push(`Feature: ${task.feature}`);
  }
  if (task.output) parts.push(`Hand in: ${task.output}`);
  parts.push(
    "",
    "Do this task now, in this reply: write out the output described above in full, as the deliverable itself, not a description of it. Nobody is waiting to give you more information; everything you need is above. Only if something essential is missing, ask one question. End with `STATUS: done` when the output is complete, or `STATUS: waiting` right after that one question.",
  );
  return parts.join("\n");
}

/** One task with the tasks it has to wait for, named by plan id. */
export type ToderoPlanTaskDependency = {
  task: ToderoPlanTask;
  blockedByTaskIds: string[];
};

function featureKey(task: ToderoPlanTask): string {
  return task.feature.trim().toLowerCase();
}

/** `after: Draft the copy, t2` -> ["Draft the copy", "t2"]. */
function splitAfterReferences(after: string): string[] {
  return after
    .split(/[,;]|\band then\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveAfterReference(
  reference: string,
  byId: Map<string, ToderoPlanTask>,
  byTitle: Map<string, ToderoPlanTask>,
): ToderoPlanTask | null {
  const cleaned = unquote(reference).trim();
  if (!cleaned) return null;
  const byIdMatch = byId.get(cleaned.toLowerCase());
  if (byIdMatch) return byIdMatch;
  const key = cleaned.toLowerCase().replace(/[.!?]+$/, "");
  return byTitle.get(key) ?? null;
}

/**
 * Works out what each task waits for, so tasks with nothing to wait for can
 * start at the same time.
 *
 * Two rules, in this order:
 *
 * 1. A task with `after` waits for the tasks it names, by title or by plan id.
 *    Names that are not in the kept list are ignored.
 * 2. A task with no usable `after` waits only for the task before it inside
 *    its own feature. The first task of every feature therefore starts
 *    straight away, and separate features run side by side.
 *
 * The result is ordered so every task comes after the tasks it waits for. If
 * the plan states an impossible order (A after B, B after A), the wait that
 * closes the circle is dropped rather than the whole plan rejected.
 */
export function resolveToderoPlanTaskDependencies(tasks: ToderoPlanTask[]): ToderoPlanTaskDependency[] {
  const byId = new Map<string, ToderoPlanTask>();
  const byTitle = new Map<string, ToderoPlanTask>();
  for (const task of tasks) {
    byId.set(task.id.toLowerCase(), task);
    const title = task.title.trim().toLowerCase().replace(/[.!?]+$/, "");
    if (title && !byTitle.has(title)) byTitle.set(title, task);
  }

  const previousInFeature = new Map<string, string>();
  const wanted = new Map<string, string[]>();
  for (const task of tasks) {
    const key = featureKey(task);
    const stated = splitAfterReferences(task.after ?? "")
      .map((reference) => resolveAfterReference(reference, byId, byTitle))
      .filter((match): match is ToderoPlanTask => match !== null && match.id !== task.id)
      .map((match) => match.id);
    const deduped = [...new Set(stated)];
    if (deduped.length > 0) {
      wanted.set(task.id, deduped);
    } else {
      const previous = previousInFeature.get(key);
      wanted.set(task.id, previous ? [previous] : []);
    }
    previousInFeature.set(key, task.id);
  }

  // Order the tasks so a blocker always lands before what it blocks. Ties keep
  // plan order, so the person sees the list they approved.
  const placed = new Set<string>();
  const ordered: ToderoPlanTaskDependency[] = [];
  const remaining = [...tasks];
  while (remaining.length > 0) {
    const readyIndex = remaining.findIndex((task) =>
      (wanted.get(task.id) ?? []).every((id) => placed.has(id)),
    );
    // Nothing is ready: the plan named a circle. Free the first task left by
    // dropping the waits it cannot satisfy, and carry on.
    const index = readyIndex === -1 ? 0 : readyIndex;
    const task = remaining.splice(index, 1)[0]!;
    const blockedByTaskIds = (wanted.get(task.id) ?? []).filter((id) => placed.has(id));
    ordered.push({ task, blockedByTaskIds });
    placed.add(task.id);
  }
  return ordered;
}
