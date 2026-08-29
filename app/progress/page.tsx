export default function ProgressPage() {
  const columns = [
    { id: "todo", label: "To do", hint: "Nothing here yet" },
    { id: "doing", label: "In progress", hint: "Empty" },
    { id: "done", label: "Done", hint: "Empty" },
  ];
  return (
    <main style={{ minHeight: "100vh", padding: "32px 28px 64px" }}>
      <header style={{ maxWidth: 1100, margin: "0 auto 28px" }}>
        <p style={{ letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)", fontSize: 12, margin: 0 }}>
          Todero
        </p>
        <h1 style={{ fontSize: 32, margin: "10px 0 8px" }}>Progress</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>A new product board. Zero items. No inherited lanes.</p>
      </header>
      <section
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16,
        }}
      >
        {columns.map((col) => (
          <div
            key={col.id}
            style={{
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              minHeight: 280,
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ fontSize: 14, margin: 0 }}>{col.label}</h2>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>0</span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 18 }}>{col.hint}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
