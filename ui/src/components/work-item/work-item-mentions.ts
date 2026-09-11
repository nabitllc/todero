/**
 * Replies render as formatted text, and an @mention inside one still has to
 * read as a mention. Doing it after the markdown is parsed is the only place
 * that works: a mention can sit inside a list item, a heading or a bold run,
 * and splitting the raw text first would break the markdown around it.
 *
 * So this is a rehype plugin. It walks the rendered tree and swaps each
 * `@name` run inside a text node for a span the stylesheet already knows.
 * Text inside code and links is left exactly as written.
 */

type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
};
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const MENTION_RE = /@[A-Za-z0-9._-]+/g;

/** The tags whose text is left alone: code is literal, a link is already marked. */
const SKIPPED_TAGS = new Set(["code", "pre", "a"]);

/**
 * Split one string into plain runs and mention runs. Exported for its own test:
 * everything the plugin does rests on this one split being right.
 */
export function splitMentions(value: string): Array<{ text: string; mention: boolean }> {
  const parts: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(value))) {
    if (match.index > last) parts.push({ text: value.slice(last, match.index), mention: false });
    parts.push({ text: match[0], mention: true });
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last), mention: false });
  return parts;
}

function mentionSpan(text: string): HastElement {
  return {
    type: "element",
    tagName: "span",
    properties: { className: ["work-item-mention"] },
    children: [{ type: "text", value: text }],
  };
}

function highlightChildren(children: HastNode[]): HastNode[] {
  const next: HastNode[] = [];
  for (const child of children) {
    if (child.type === "text") {
      const value = (child as HastText).value;
      const parts = splitMentions(value);
      if (parts.length === 1 && !parts[0].mention) {
        next.push(child);
        continue;
      }
      for (const part of parts) {
        next.push(part.mention ? mentionSpan(part.text) : { type: "text", value: part.text });
      }
      continue;
    }
    next.push(child);
  }
  return next;
}

/**
 * Depth first, and only ever over the nodes that were already there: the spans
 * this makes hold an `@name` of their own, so walking into them would split the
 * same text for ever.
 */
function walk(node: HastNode): void {
  if (node.type === "element" && SKIPPED_TAGS.has((node as HastElement).tagName)) return;
  const children = (node as { children?: HastNode[] }).children;
  if (!children) return;
  for (const child of children) walk(child);
  (node as { children?: HastNode[] }).children = highlightChildren(children);
}

/** The rehype plugin itself: `rehypePlugins={[rehypeMentions]}`. */
export function rehypeMentions() {
  return (tree: HastNode) => {
    walk(tree);
  };
}
