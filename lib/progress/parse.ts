/*
  Reads the four template fields out of a PR body. Missing fields stay
  blank; nothing is inferred except the summary fallback.
*/
export interface ParsedBody {
  summary: string;
  tokens: number | null;
  usd: number | null;
  proof: string | null;
  session: string | null;
}

const SUMMARY_MAX = 160;

function section(body: string, name: string): string | null {
  const heading = new RegExp(`^#{1,3}\\s*${name}\\s*$`, "im");
  const m = heading.exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const end = /^#{1,3}\s+\S/m.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).trim();
}

function line(body: string, name: string): string | null {
  const m = new RegExp(`^\\*{0,2}${name}\\*{0,2}\\s*:\\s*(.+)$`, "im").exec(body);
  return m ? m[1].trim() : null;
}

/** Git trailers (Co-Authored-By, Signed-off-by, …) are metadata, not prose. */
function withoutTrailers(body: string): string {
  return body
    .split("\n")
    .filter((l) => !/^[A-Z][A-Za-z-]+:\s\S/.test(l.trim()) || /^(Summary|Cost|Proof|Session):/i.test(l.trim()))
    .join("\n");
}

function firstParagraph(body: string): string {
  const para = withoutTrailers(body)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim())
    .find((p) => p.length > 0 && !/^(<!--|\[x\]|\[ \])/.test(p));
  return para ?? "";
}

/** Markdown out, words in: bold, code, links, headings, list markers. */
function plain(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*`]+|~~/g, "")
    .replace(/(^|\s)_([^_\s][^_]*?)_(?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*>\s?/gm, "");
}

function clip(text: string): string {
  const one = plain(text).replace(/\s+/g, " ").trim();
  if (one.length <= SUMMARY_MAX) return one;
  const cut = one.slice(0, SUMMARY_MAX - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > SUMMARY_MAX / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,;:.—-]+$/, "")}…`;
}

export function parseBody(raw: string | null | undefined): ParsedBody {
  const body = (raw ?? "").replace(/\r\n/g, "\n");
  const summary = clip(section(body, "Summary") ?? line(body, "Summary") ?? firstParagraph(body));

  const cost = section(body, "Cost") ?? line(body, "Cost") ?? "";
  const tokens = /tokens\s*=\s*([\d,._]+)/i.exec(cost)?.[1];
  const usd = /usd\s*=\s*\$?([\d.]+)/i.exec(cost)?.[1];

  const proofText = section(body, "Proof") ?? line(body, "Proof") ?? "";
  const proof = /https?:\/\/\S+/.exec(proofText)?.[0]?.replace(/[)>\]]+$/, "") ?? null;

  const session = section(body, "Session") ?? line(body, "Session");

  return {
    summary,
    tokens: tokens ? Number(tokens.replace(/[,_]/g, "")) : null,
    usd: usd ? Number(usd) : null,
    proof,
    session: session ? clip(session) : null,
  };
}
