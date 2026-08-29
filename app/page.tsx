export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ maxWidth: 560 }}>
        <p style={{ letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)", fontSize: 12, margin: 0 }}>
          Todero
        </p>
        <h1 style={{ fontSize: 42, lineHeight: 1.1, margin: "16px 0 12px" }}>The workspace is waking up.</h1>
        <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          Todero is a fresh start. The public board is empty on purpose.
          The local app runs from this repo when you need agents and a vault.
        </p>
        <p style={{ marginTop: 28 }}>
          <a href="/progress">Open the product board</a>
        </p>
      </div>
    </main>
  );
}
