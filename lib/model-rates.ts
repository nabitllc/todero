// Rough $/1M-token rate for the "Projected Monthly" estimate on the Crew
// budget panel (components/tabs/AgentDetailView.tsx). Deliberately outside
// components/tabs/ and free of any server-only import, so it is safe from a
// client component and lives in exactly one place rather than a per-tab
// literal.
//
// Only the cloud models Todero can actually spawn an agent on today have a
// real published rate; a local Ollama tag (or anything else unrecognized)
// costs nothing to run, so it gets 0 rather than a guessed cloud number —
// the previous default silently billed local agents at Sonnet-tier pricing.

const CLOUD_MODEL_RATES_PER_MILLION_TOKENS: Record<string, number> = {
  'claude-haiku-4-5': 0.80,
  'claude-sonnet-4-6': 3.00,
}

export function estimateModelRateUsd(model: string): number {
  return CLOUD_MODEL_RATES_PER_MILLION_TOKENS[model] ?? 0
}
