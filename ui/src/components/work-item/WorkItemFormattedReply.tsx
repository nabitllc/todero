/**
 * A reply, as formatted text. Headings, lists, bold and code render the way
 * they do in the task's own body — same renderer, same rules — and a long one
 * folds after twelve lines with "Show all" so a wall of text never buries the
 * turn bar under it.
 *
 * The fold is a height clamp rather than a truncation of the text: cutting the
 * markdown at line twelve would cut a list or a fence in half.
 */
import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeMentions } from "./work-item-mentions";

export const REPLY_FOLD_LINES = 12;

/** How many lines the source is. A blank trailing line never makes it fold. */
export function replyLineCount(body: string): number {
  const trimmed = body.replace(/\s+$/, "");
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

/** Whether this reply is long enough to fold. Pure, so the rule has one home. */
export function replyFolds(body: string, limit: number = REPLY_FOLD_LINES): boolean {
  return replyLineCount(body) > limit;
}

export type WorkItemFormattedReplyProps = {
  body: string;
  /** Highlight @mentions in the rendered text. On for what a person wrote. */
  highlight?: boolean;
  /** Overrides the twelve-line fold; tests use it, the app does not. */
  foldAfterLines?: number;
};

export function WorkItemFormattedReply(props: WorkItemFormattedReplyProps) {
  const { body, highlight = false, foldAfterLines = REPLY_FOLD_LINES } = props;
  const [expanded, setExpanded] = useState(false);
  const folds = useMemo(() => replyFolds(body, foldAfterLines), [body, foldAfterLines]);
  const folded = folds && !expanded;

  return (
    <div className="work-item-formatted-reply" data-testid="work-item-formatted-reply">
      <div
        className={folded ? "work-item-reply-text work-item-reply-folded" : "work-item-reply-text"}
        data-work-item-reply-folded={folded ? "true" : "false"}
        style={folded ? { ["--wi-fold-lines" as string]: String(foldAfterLines) } : undefined}
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={highlight ? [rehypeMentions] : []}
        >
          {body}
        </Markdown>
      </div>
      {folded ? (
        <button
          type="button"
          className="work-item-reply-expand"
          data-testid="work-item-reply-expand"
          onClick={() => setExpanded(true)}
        >
          Show all
        </button>
      ) : null}
    </div>
  );
}
