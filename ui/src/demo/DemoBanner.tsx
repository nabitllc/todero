import { store } from "./store";

/*
  The one line that says what this is. Bottom-pinned so it never collides with
  the product header; the only control is Reset.
*/
export function DemoBanner() {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        minHeight: "2.5rem",
        padding: "0 1rem",
        borderTop: "1px solid var(--border)",
        background: "var(--background)",
        color: "var(--muted-foreground)",
        fontSize: "0.8125rem",
      }}
    >
      <span>Demo — an invented company. Nothing leaves your browser.</span>
      <button
        type="button"
        onClick={() => {
          store.reset();
          window.location.reload();
        }}
        style={{
          minHeight: "2.75rem",
          minWidth: "2.75rem",
          padding: "0 0.5rem",
          background: "none",
          border: 0,
          color: "var(--foreground)",
          textDecoration: "underline",
          textUnderlineOffset: "0.2em",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        Reset
      </button>
    </div>
  );
}
