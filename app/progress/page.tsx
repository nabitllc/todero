export default function ProgressPage() {
  const columns = [
    { id: "todo", label: "To do", items: [] as { title: string; evidence: string }[] },
    { id: "doing", label: "In progress", items: [] as { title: string; evidence: string }[] },
    {
      id: "done",
      label: "Done",
      items: [
        {
          title: "In-app work-item view",
          evidence:
            "Task screen is a brief + log, not a chat thread. Type stamp, short title, four sections, facts rail including Bolt Coming, New status with unassigned, composer “Comment, or @ an agent”. SHA 11b7dac. Designer passed look.",
        },
        {
          title: "Public landing",
          evidence:
            "Live https://todero.vercel.app/ — waitlist + use-Todero copy. H1 “A company of AI agents,” / “on your laptop.” See the product → /demo. No npx. No product shot. SHA bd919ce (copy and waitlist route). Look accepted. Designer passed look. Join not live until RESEND_API_KEY.",
        },
      ],
    },
  ];
  return (
    <main style={{ minHeight: "100vh", padding: "32px 28px 64px" }}>
      <header style={{ maxWidth: 1100, margin: "0 auto 28px" }}>
        <p style={{ letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)", fontSize: 12, margin: 0 }}>
          Todero
        </p>
        <h1 style={{ fontSize: 32, margin: "10px 0 8px" }}>Progress</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Public board. Landing and work-item view are live. No scores. No invented companies.
        </p>
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
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{col.items.length}</span>
            </div>
            {col.items.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 18 }}>Empty</p>
            ) : (
              col.items.map((item) => (
                <article
                  key={item.title}
                  style={{
                    marginTop: 16,
                    padding: 12,
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                  }}
                >
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>{item.title}</h3>
                  <p style={{ color: "var(--muted)", fontSize: 13, margin: 0, lineHeight: 1.45 }}>{item.evidence}</p>
                </article>
              ))
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
