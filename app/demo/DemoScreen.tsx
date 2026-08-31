"use client";

import { useState } from "react";
import { demoWorkItem as item } from "./fixture";
import "./work-item.css";
import "./demo.css";

function PaperclipIcon() {
  return (
    <svg
      className="work-item-attach-icon"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.414 8.586a6 6 0 0 0 8.486 8.486L20.5 13" />
    </svg>
  );
}

export default function DemoScreen() {
  const [comment, setComment] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);
  const [type, setType] = useState<string>(item.type);

  return (
    <div className="demo-root">
      <div className="work-item">
        <div className="work-item-slab">
          <div className="work-item-header">
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="work-item-stamp"
                onClick={() => setTypeOpen((open) => !open)}
              >
                {type}
              </button>
              {typeOpen ? (
                <div className="work-item-stamp-menu" role="listbox">
                  {["Feature", "Story", "Task", "Bug"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="work-item-stamp-option"
                      aria-selected={option === type}
                      onClick={() => {
                        setType(option);
                        setTypeOpen(false);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="work-item-trail">
              <span className="work-item-trail-current">{item.identifier}</span>
            </div>
            <div className="work-item-status-wrap">
              <span className="work-item-status work-item-status-muted">{item.status}</span>
            </div>
          </div>
          <h1 className="work-item-title">{item.title}</h1>
          <div className="work-item-split">
            <div className="work-item-main">
              <div className="work-item-body">
                <p style={{ margin: 0 }}>{item.body}</p>
              </div>
              {item.sections.map((section) => (
                <section className="work-item-section" key={section.title}>
                  <h2 className="work-item-section-title">{section.title}</h2>
                  <div className="work-item-section-body">{section.body}</div>
                </section>
              ))}
              <div className="work-item-checklist">
                {item.checklist.map((check) => (
                  <label className="work-item-check-item" key={check.id}>
                    <input type="checkbox" defaultChecked={check.done} />
                    {check.label}
                  </label>
                ))}
              </div>
            </div>
            <aside className="work-item-facts">
              <div className="work-item-fact">
                <span className="work-item-fact-label">Assignee</span>
                <span className="work-item-fact-value work-item-fact-muted">{item.assignee}</span>
              </div>
              <div className="work-item-fact">
                <span className="work-item-fact-label">Priority</span>
                <span className="work-item-fact-value work-item-fact-empty" />
              </div>
              <div className="work-item-fact">
                <span className="work-item-fact-label">Created</span>
                <span className="work-item-fact-value">{item.created}</span>
              </div>
              <div className="work-item-fact">
                <span className="work-item-fact-label">Closed</span>
                <span className="work-item-fact-value work-item-fact-muted">{item.closed}</span>
              </div>
              <div className="work-item-fact">
                <span className="work-item-fact-label">Token usage</span>
                <span className="work-item-fact-value work-item-fact-mono work-item-fact-muted">
                  {item.tokenUsage}
                </span>
              </div>
              <div className="work-item-fact">
                <span className="work-item-fact-label">Token cost</span>
                <span className="work-item-fact-value work-item-fact-mono work-item-fact-muted">
                  {item.tokenCost}
                </span>
              </div>
              <div className="work-item-fact">
                <span className="work-item-fact-label">Bolt</span>
                <span className="work-item-bolt">{item.bolt}</span>
              </div>
            </aside>
          </div>
        </div>
        <div className="work-item-log-split" />
        <div className="work-item-log">
          <div className="work-item-activity">
            <p className="work-item-activity-empty">{item.emptyActivity}</p>
          </div>
          <form
            className="work-item-composer"
            onSubmit={(event) => {
              event.preventDefault();
              setComment("");
            }}
          >
            <textarea
              className="work-item-composer-input"
              placeholder={item.composerPlaceholder}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={2}
            />
            <div className="work-item-composer-row">
              <button type="button" className="work-item-attach" aria-label="Attach">
                <PaperclipIcon />
              </button>
              <button type="button" className="work-item-auto">
                Auto mode
              </button>
              <button type="submit" className="work-item-send">
                Send
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
