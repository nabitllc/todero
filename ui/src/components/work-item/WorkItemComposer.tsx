/**
 * The box at the foot of the conversation, plus the quick replies above it.
 *
 * Enter sends and Shift+Enter starts a new line, which is what a chat box does
 * everywhere else. @ opens the list of agents. Attachments are unchanged.
 */
import { useRef, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { Paperclip } from "lucide-react";
import { COMPOSER_PLACEHOLDER } from "./work-item-model";
import { composerChipsFor, type ComposerChip, type ComposerChipsView } from "./work-item-chips";

export type WorkItemAgentOption = { id: string; name: string };

export type WorkItemComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  chips: ComposerChipsView;
  onChip: (chip: ComposerChip) => void;
  agentOptions: WorkItemAgentOption[];
  agentListOpen: boolean;
  onAgentListOpen: (open: boolean) => void;
  onPickAgent: (agent: WorkItemAgentOption) => void;
  onAttach?: (file: File) => void;
  /** The Auto mode button keeps its place in the row. */
  modeLabel: string;
  onModeChange?: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function WorkItemComposer(props: WorkItemComposerProps) {
  const {
    value,
    onChange,
    onSend,
    chips,
    onChip,
    agentOptions,
    agentListOpen,
    onAgentListOpen,
    onPickAgent,
    onAttach,
    modeLabel,
    onModeChange,
    inputRef,
  } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const quickReplies = composerChipsFor(chips);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    onSend();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "@") onAgentListOpen(true);
    if (event.key === "Escape") onAgentListOpen(false);
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <form className="work-item-composer" data-testid="work-item-composer" onSubmit={submit}>
      {quickReplies.length > 0 ? (
        <div className="work-item-chips" data-testid="work-item-chips">
          {quickReplies.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="work-item-chip"
              data-testid={`work-item-chip-${chip.id}`}
              onClick={() => onChip(chip)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        className="work-item-composer-input"
        data-testid="work-item-composer-input"
        aria-label={COMPOSER_PLACEHOLDER}
        placeholder={COMPOSER_PLACEHOLDER}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          if (event.target.value.endsWith("@")) onAgentListOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {agentListOpen ? (
        <div className="work-item-agent-list" data-testid="work-item-agent-list">
          {agentOptions.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="work-item-agent-option"
              onClick={() => onPickAgent(agent)}
            >
              {agent.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="work-item-composer-row">
        <button
          type="button"
          className="work-item-attach"
          aria-label="Attach"
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip className="work-item-attach-icon" />
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onAttach?.(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="work-item-auto"
          data-testid="work-item-auto-mode"
          onClick={() => onModeChange?.()}
        >
          {modeLabel}
        </button>
        <button type="submit" className="work-item-send">
          Send
        </button>
      </div>
    </form>
  );
}
