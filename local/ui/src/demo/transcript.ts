/*
  Canned agent replies. No model runs in the demo; the words are fixed and
  say so when read closely.
*/
const replies: Record<string, string[]> = {
  lead: [
    "On it. I've split this into two items and assigned Build the first. I'll report back before the bolt closes.",
    "Checked the goal. We're on track for the 24-hour window; nothing is blocked on my side.",
  ],
  research: [
    "Two options fit: a static host with a CDN, or the docs framework's own hosting. I recommend the static host — cheaper and we already own the domain.",
  ],
  build: [
    "CI is green on the site build. Left to do: the search index and the redirect map. Estimating two hours.",
  ],
  test: [
    "Ran the smoke suite against the preview: 14 passed, 0 failed. Links check out; one image is missing alt text — filed as a follow-up.",
  ],
  write: [
    "Draft is up in the plan document. It leads with what the app does, then the install path. Ready for review.",
  ],
};

export function agentReply(agentName: string, prompt: string): string {
  const list = replies[agentName.toLowerCase()] ?? [
    `Noted. I'll pick this up next heartbeat. (Demo reply — no model ran for: "${prompt.slice(0, 60)}")`,
  ];
  return list[Math.floor(Math.random() * list.length)];
}
