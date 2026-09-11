/**
 * A task made from an approved plan carries a brief written for the model:
 * the goal, the feature it belongs to, what "done" means, what to hand in,
 * what the person said while planning, and then a standing instruction telling
 * the model to do the work in this reply and sign off with a status.
 *
 * The person should read the first part and never the second. The standing
 * instruction is machinery — it is what Nova sees, not what the task is — and
 * it contradicts the turn bar besides: it tells the reader nobody is waiting
 * for them at the same moment the bar says it is their turn.
 *
 * So the card parses the brief into labelled lines and drops the instruction.
 * Nothing is rewritten: every line the person wrote is shown exactly as it was
 * written, and anything the parser does not recognise is kept as the rest.
 */

export type WorkItemBriefLine = {
  label: string;
  value: string;
};

export type WorkItemBrief = {
  /** Goal, Feature, Done when, Hand in — whichever the brief carries. */
  lines: WorkItemBriefLine[];
  /** What the person said while planning, in their own words. */
  said: string[];
  /** Anything the parser did not recognise, kept verbatim. */
  rest: string;
};

/** The labels the brief uses, in the order the card shows them. */
const BRIEF_LABELS = ["Goal", "Feature", "Done when", "Hand in"] as const;

const SAID_HEADING = /^What the person said when we planned this\b.*$/i;

/**
 * The standing instruction. Matched on its opening rather than in full, so a
 * reworded tail still drops out of the body instead of leaking to the person.
 */
const STANDING_INSTRUCTION = /^Do this task now\b/i;

function matchLabel(line: string): WorkItemBriefLine | null {
  for (const label of BRIEF_LABELS) {
    if (!line.toLowerCase().startsWith(`${label.toLowerCase()}:`)) continue;
    const value = line.slice(label.length + 1).trim();
    if (!value) return null;
    return { label, value };
  }
  return null;
}

/**
 * True when a body looks like a plan-made brief rather than something a person
 * typed. One labelled line is enough: a brief always opens with its goal.
 */
export function isWorkItemBrief(body: string | null | undefined): boolean {
  return parseWorkItemBrief(body).lines.length > 0;
}

export function parseWorkItemBrief(body: string | null | undefined): WorkItemBrief {
  const lines: WorkItemBriefLine[] = [];
  const said: string[] = [];
  const rest: string[] = [];
  let collectingSaid = false;

  for (const raw of (body ?? "").split(/\r?\n/)) {
    const line = raw.trim();

    if (STANDING_INSTRUCTION.test(line)) {
      // Everything from here on is the instruction to the model.
      break;
    }

    if (SAID_HEADING.test(line)) {
      collectingSaid = true;
      continue;
    }

    if (collectingSaid) {
      // A bullet with nothing after it is still a bullet: it must not be taken
      // as the end of the section and push the lines below it into the rest.
      const bullet = line.match(/^[-*]\s*(.*)$/);
      if (bullet) {
        const value = bullet[1]!.trim();
        if (value) said.push(value);
        continue;
      }
      if (!line) continue;
      collectingSaid = false;
    }

    const labelled = matchLabel(line);
    if (labelled) {
      lines.push(labelled);
      continue;
    }

    rest.push(raw);
  }

  // Show the labels in the order the card lists them, not the order they
  // happened to be written in, and never the same label twice.
  const ordered: WorkItemBriefLine[] = [];
  for (const label of BRIEF_LABELS) {
    const found = lines.find((line) => line.label === label);
    if (found) ordered.push(found);
  }

  return {
    lines: ordered,
    said,
    rest: rest.join("\n").replace(/^\s+/, "").replace(/\s+$/, ""),
  };
}
