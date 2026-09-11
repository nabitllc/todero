import type { TurnActionId, TurnSentenceResult } from "./turn-sentence";

/**
 * The bar under the title: one sentence saying whose turn it is, and the
 * buttons for that turn. What it says is decided by `turnSentence`; this draws
 * it and nothing else.
 */

/** Hover hints only. Nothing in the bar needs a keyboard to reach it. */
const TURN_ACTION_KEYS: Partial<Record<TurnActionId, string>> = {
  accept: "A",
  "send-back": "S",
};

export function WorkItemTurnBar({
  turn,
  onAction,
}: {
  turn: TurnSentenceResult;
  onAction: (id: TurnActionId) => void;
}) {
  return (
    <div className="work-item-turn-bar" data-testid="work-item-turn-bar" data-tone={turn.tone}>
      {/* The sentence is the moment a person learns it is their turn, and it can
          flip while they are looking elsewhere. A polite live region announces
          the new sentence without interrupting anything they are typing. */}
      <p
        className="work-item-turn-sentence"
        data-testid="work-item-turn-sentence"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {turn.text}
      </p>
      {turn.actions.length > 0 ? (
        <div className="work-item-turn-actions">
          {turn.actions.map((action) => {
            const hint = TURN_ACTION_KEYS[action.id];
            return (
              <button
                key={action.id}
                type="button"
                className="work-item-turn-action"
                data-testid="work-item-turn-action"
                data-action={action.id}
                title={hint ? `${action.label} (${hint})` : action.label}
                onClick={() => onAction(action.id)}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
