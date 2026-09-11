/**
 * Where the hand-in reply used to sit in the conversation: one line that says
 * which version was handed in and opens it. The output itself lives under
 * Deliverable now, so the conversation stays a conversation.
 */
export type WorkItemHandedInCardProps = {
  version: number;
  onOpen: () => void;
};

export function WorkItemHandedInCard({ version, onOpen }: WorkItemHandedInCardProps) {
  return (
    <div className="work-item-handed-in" data-testid="work-item-handed-in-card">
      <span className="work-item-handed-in-text">Handed in version {version}</span>
      <span className="work-item-handed-in-sep">·</span>
      <button
        type="button"
        className="work-item-handed-in-open"
        data-testid="work-item-handed-in-open"
        onClick={onOpen}
      >
        Open
      </button>
    </div>
  );
}
