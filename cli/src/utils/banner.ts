import pc from "picocolors";

const TODERO_ART = [
  "████████╗ ██████╗ ██████╗ ███████╗██████╗  ██████╗",
  "╚══██╔══╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗██╔═══██╗",
  "   ██║   ██║   ██║██║  ██║█████╗  ██████╔╝██║   ██║",
  "   ██║   ██║   ██║██║  ██║██╔══╝  ██╔══██╗██║   ██║",
  "   ██║   ╚██████╔╝██████╔╝███████╗██║  ██║╚██████╔╝",
  "   ╚═╝    ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝",
] as const;

const TAGLINE = "The app people use to manage AI agents for work";

export function printToderoCliBanner(): void {
  const lines = [
    "",
    ...TODERO_ART.map((line) => pc.cyan(line)),
    pc.blue("  ───────────────────────────────────────────────────────"),
    pc.bold(pc.white(`  ${TAGLINE}`)),
    "",
  ];

  console.log(lines.join("\n"));
}
