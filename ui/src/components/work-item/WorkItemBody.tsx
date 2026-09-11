/**
 * The middle of the card: the brief or the body, the sections the description
 * carries, the tasks a plan made, and the checklist. Lifted out of the card
 * whole so the card itself is only a mount point.
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@/lib/router";
import { WorkItemBriefBlock } from "./WorkItemBriefBlock";
import type { WorkItemBrief } from "./work-item-brief";
import {
  EMPTY_BODY_PLACEHOLDER,
  taskRowLabel,
  type WorkItemChecklistItem,
  type WorkItemSection,
  type WorkItemTaskRow,
} from "./work-item-model";

export type WorkItemBodyProps = {
  body: string;
  bodyEditable: boolean;
  brief: WorkItemBrief | null;
  editing: boolean;
  bodyDraft: string;
  onBodyDraftChange: (value: string) => void;
  onStartEditing: () => void;
  onSave: () => void;
  sections: WorkItemSection[];
  tasks: WorkItemTaskRow[];
  checklist: WorkItemChecklistItem[];
};

export function WorkItemBody(props: WorkItemBodyProps) {
  const {
    body,
    bodyEditable,
    brief,
    editing,
    bodyDraft,
    onBodyDraftChange,
    onStartEditing,
    onSave,
    sections,
    tasks,
    checklist,
  } = props;

  return (
    <div className="work-item-main">
      {editing ? (
        <textarea
          className="work-item-body-editor"
          data-testid="work-item-body-editor"
          value={bodyDraft}
          onChange={(event) => onBodyDraftChange(event.target.value)}
          onBlur={onSave}
          autoFocus
        />
      ) : brief ? (
        <WorkItemBriefBlock brief={brief} editable={bodyEditable} onEdit={onStartEditing} />
      ) : (
        <div
          className={body.trim() ? "work-item-body" : "work-item-body work-item-body-empty"}
          data-testid="work-item-body"
          data-work-item-body-present={body.trim() ? "true" : "false"}
          data-work-item-body-editable={bodyEditable ? "true" : "false"}
          onClick={() => {
            if (!bodyEditable) return;
            onStartEditing();
          }}
        >
          {body.trim() ? <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown> : EMPTY_BODY_PLACEHOLDER}
        </div>
      )}

      {sections.map((section) => (
        <section
          key={section.title}
          className="work-item-section"
          data-testid="work-item-section"
          data-section-title={section.title}
        >
          <h2 className="work-item-section-title">{section.title}</h2>
          <div className="work-item-section-body">
            <Markdown remarkPlugins={[remarkGfm]}>{section.body}</Markdown>
          </div>
        </section>
      ))}

      {tasks.length > 0 ? (
        <section className="work-item-section" data-testid="work-item-tasks">
          <h2 className="work-item-section-title">Tasks</h2>
          <ol className="work-item-task-list">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="work-item-task-row"
                data-testid="work-item-task-row"
                data-status={task.status}
              >
                <span
                  className={`work-item-task-status work-item-task-status-${task.queued && task.status !== "done" ? "queued" : task.status}`}
                >
                  {taskRowLabel(task)}
                </span>
                <Link to={task.href} className="work-item-task-link">
                  <span className="work-item-task-id">{task.identifier}</span> {task.title}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {checklist.length > 0 ? (
        <div className="work-item-checklist" data-testid="work-item-checklist">
          {checklist.map((item) => (
            <label key={item.id} className="work-item-check-item">
              <input type="checkbox" checked={item.done} readOnly />
              <span>{item.text}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
