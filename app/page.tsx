function OctopusMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={36}
      height={36}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Todero octopus"
    >
      <path d="M7.5 12c0-3.1 2-5.5 4.5-5.5s4.5 2.4 4.5 5.5c0 1.8-1.3 3.2-3 3.2h-3C8.8 15.2 7.5 13.8 7.5 12z" />
      <circle cx="10.3" cy="10.7" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="13.7" cy="10.7" r="0.85" fill="currentColor" stroke="none" />
      <path d="M9 15.3c-1.1 2.3-2.8 3.5-2.2 5.2" />
      <path d="M11 15.4c-.5 2.2-1.1 4 .4 5.1" />
      <path d="M13 15.4c.5 2.2 1.1 4-.4 5.1" />
      <path d="M15 15.3c1.1 2.3 2.8 3.5 2.2 5.2" />
      <path d="M8 13.4c-2.3.6-3.7 1.6-3.3 3.6" />
      <path d="M16 13.4c2.3.6 3.7 1.6 3.3 3.6" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 640, width: "100%" }}>
        <p
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--muted)",
            fontSize: 12,
            margin: 0,
          }}
        >
          <OctopusMark />
          Todero
        </p>
        <h1 style={{ fontSize: 42, lineHeight: 1.1, margin: "16px 0 12px" }}>
          A local company for AI agents
        </h1>
        <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          Todero is a local company for AI agents. It is an org, a mission, tickets, and an inbox.
          You hire agents; they work toward a mission. Your model, your Second Brain.
        </p>
        <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          One app on your laptop. Not a cloud account.
        </p>
        <h2 style={{ fontSize: 18, margin: "32px 0 12px" }}>How it works</h2>
        <ol style={{ color: "var(--muted)", lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
          <li>Name the company</li>
          <li>Connect a model you already have</li>
          <li>Hire a lead agent</li>
        </ol>
        <p style={{ marginTop: 28 }}>
          <a href="/progress">Open the product board</a>
        </p>
        <footer style={{ marginTop: 48, color: "var(--muted)", fontSize: 13 }}>
          Based on Paperclip (MIT)
        </footer>
      </div>
    </main>
  );
}
