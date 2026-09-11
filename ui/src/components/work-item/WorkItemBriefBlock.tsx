import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WorkItemBrief } from "./work-item-brief";

/**
 * A task made from a plan carries a brief written for the model. This reads it
 * back as labelled lines. Nothing is reworded: the person's own sentences are
 * shown exactly as they were typed, and anything the parser did not recognise
 * is rendered as it stands.
 */
export function WorkItemBriefBlock({
  brief,
  editable,
  onEdit,
}: {
  brief: WorkItemBrief;
  editable: boolean;
  onEdit: () => void;
}) {
  return (
    <section
      className="work-item-brief"
      data-testid="work-item-brief-block"
      data-work-item-body-editable={editable ? "true" : "false"}
      onClick={() => {
        if (editable) onEdit();
      }}
    >
      <h2 className="work-item-section-title">Brief</h2>
      <dl className="work-item-brief-lines">
        {brief.lines.map((line) => (
          <div key={line.label} className="work-item-brief-line" data-brief-label={line.label}>
            <dt className="work-item-brief-label">{line.label}</dt>
            <dd className="work-item-brief-value">{line.value}</dd>
          </div>
        ))}
        {brief.said.length > 0 ? (
          <div className="work-item-brief-line" data-brief-label="What you said">
            <dt className="work-item-brief-label">What you said</dt>
            <dd className="work-item-brief-value">
              <ul className="work-item-brief-said">
                {brief.said.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
      {brief.rest ? (
        <div className="work-item-body" data-testid="work-item-body">
          <Markdown remarkPlugins={[remarkGfm]}>{brief.rest}</Markdown>
        </div>
      ) : null}
    </section>
  );
}
