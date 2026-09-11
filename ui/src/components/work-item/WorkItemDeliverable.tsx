/**
 * The Deliverable tab: what the agent actually handed in, as a document rather
 * than as a message. A version picker when there is more than one, a copy
 * button, and a download — the three things a person does with a finished piece
 * of work before deciding about it.
 */
import { useMemo, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocumentRevision, IssueDocument } from "@todero/shared";
import { copyTextToClipboard } from "@/lib/clipboard";
import { deliverableVersions, versionLabel, type DeliverableVersion } from "./work-item-deliverable";

export type WorkItemDeliverableProps = {
  document: IssueDocument;
  revisions?: DocumentRevision[];
  /** True while this version is still waiting to be accepted or sent back. */
  reviewPending?: boolean;
  /** True once the task is done, which is what "accepted" means on the label. */
  accepted?: boolean;
};

export function WorkItemDeliverable(props: WorkItemDeliverableProps) {
  const { document: doc, revisions = [], reviewPending = false, accepted = false } = props;
  const versions = useMemo<DeliverableVersion[]>(
    () => deliverableVersions(doc, revisions),
    [doc, revisions],
  );
  const [picked, setPicked] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const current = versions.find((version) => version.number === picked) ?? versions[0];
  const body = current?.body ?? doc.body ?? "";

  async function copy() {
    try {
      await copyTextToClipboard(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard is not worth an error card; the
      // text is on screen and selectable either way.
    }
  }

  function download() {
    const blob = new Blob([body], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${(doc.title || "Output").replace(/[^\w.-]+/g, "-")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="work-item-deliverable" data-testid="work-item-deliverable">
      <div className="work-item-deliverable-head">
        {versions.length > 1 ? (
          <select
            className="work-item-deliverable-versions"
            data-testid="work-item-deliverable-versions"
            aria-label="Version"
            value={current?.number ?? ""}
            onChange={(event) => setPicked(Number(event.target.value))}
          >
            {versions.map((version) => (
              <option key={version.number} value={version.number}>
                {versionLabel(version, {
                  latest: version.number === versions[0]?.number,
                  reviewPending,
                  accepted,
                })}
              </option>
            ))}
          </select>
        ) : (
          <span className="work-item-deliverable-version" data-testid="work-item-deliverable-version">
            {current
              ? versionLabel(current, { latest: true, reviewPending, accepted })
              : (doc.title || "Output")}
          </span>
        )}
        <div className="work-item-deliverable-actions">
          <button
            type="button"
            className="work-item-deliverable-action"
            data-testid="work-item-deliverable-copy"
            onClick={() => { void copy(); }}
          >
            {copied ? <Check className="work-item-deliverable-icon" /> : <Copy className="work-item-deliverable-icon" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="work-item-deliverable-action"
            data-testid="work-item-deliverable-download"
            onClick={download}
          >
            <Download className="work-item-deliverable-icon" />
            Download
          </button>
        </div>
      </div>
      <div className="work-item-deliverable-body" data-testid="work-item-deliverable-body">
        <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
      </div>
    </div>
  );
}
