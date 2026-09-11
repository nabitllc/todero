/**
 * "What Nova sees": the brief, the standing instructions and the conversation
 * exactly as they were handed to the model on its last turn. Read-only, and
 * read out of what that turn stored — never rebuilt from today's state.
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentContext } from "./agent-context";
import "./what-the-agent-sees.css";

export type WhatTheAgentSeesProps = {
  context: AgentContext | null;
  /** Shown while the last turn's record is still being fetched. */
  loading?: boolean;
};

function Block({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <section className="agent-sees-block">
      <h4 className="agent-sees-block-title">{title}</h4>
      <div className="agent-sees-markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
      </div>
    </section>
  );
}

export function WhatTheAgentSees({ context, loading = false }: WhatTheAgentSeesProps) {
  if (loading) {
    return (
      <div className="agent-sees" data-testid="what-the-agent-sees">
        <p className="agent-sees-empty">Reading the last turn…</p>
      </div>
    );
  }
  if (!context) {
    return (
      <div className="agent-sees" data-testid="what-the-agent-sees">
        <p className="agent-sees-empty" data-testid="what-the-agent-sees-empty">
          Nothing yet — this task has not had a turn.
        </p>
      </div>
    );
  }

  const who = [context.roleTitle, context.companyName].filter(Boolean).join(" at ");

  return (
    <div className="agent-sees" data-testid="what-the-agent-sees">
      {context.agentName || who || context.mission ? (
        <section className="agent-sees-block" data-testid="agent-sees-identity">
          <h4 className="agent-sees-block-title">Who it thinks it is</h4>
          {context.agentName ? <p className="agent-sees-line">{context.agentName}</p> : null}
          {who ? <p className="agent-sees-line agent-sees-muted">{who}</p> : null}
          {context.mission ? <p className="agent-sees-line agent-sees-muted">{context.mission}</p> : null}
        </section>
      ) : null}

      <Block title="The brief" body={context.brief} />
      <Block title="Standing instructions" body={context.standingInstructions} />
      <Block title="What it was asked this turn" body={context.turnInstruction} />

      {context.thread.length > 0 ? (
        <section className="agent-sees-block" data-testid="agent-sees-thread">
          <h4 className="agent-sees-block-title">The conversation it was given</h4>
          <div className="agent-sees-thread">
            {context.thread.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`agent-sees-turn agent-sees-turn-${message.role}`}
              >
                <span className="agent-sees-turn-role">{message.role === "agent" ? "It said" : "You said"}</span>
                <div className="agent-sees-markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>{message.body}</Markdown>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
