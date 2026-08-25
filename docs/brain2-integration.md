# Todero ↔ Mich-Brain2

**Status:** contract. Written 2026-08-25 as part of the reconstruction (TOD-2381).

## The rule that comes first

`C:\Development\Mich-Brain2` is **READ-ONLY** to Todero and to every agent Todero
runs. The single exception is `Mich-Brain2/_pending/`, which is the vault's
designated AI outbox. Nothing else in the vault may be created, modified, or
deleted by this application, ever, for any reason.

If you are an agent reading this: a task that seems to require editing the vault
is a task that has been misunderstood. Write a proposal to `_pending/` instead.

## Why Todero does not replace Brain2

They hold different kinds of memory, and conflating them destroys both.

|  | Brain2 | Todero |
|---|---|---|
| Role | Curated, human-approved, durable | Operational, machine-generated, disposable |
| Content | Identity, playbooks, agent definitions, skills | Run records, attempts, failures, costs, heartbeats |
| Scope | Every project | This project |
| Volume | Small and deliberate | Tens of thousands of rows |
| Write path | Human approval only | Automatic |
| Lifetime | Years | Rolling window |

Hermes Agent arrived at the same split independently: it caps always-in-context
memory at roughly 1,300 tokens and makes overflow **return an error rather than
truncate**, precisely so that consolidation is forced rather than optional —
while keeping 90 days of raw transcripts in SQLite, retrieved on demand.

Read that mapping onto this repo: **Brain2 is the capped, curated memory.
Todero's run store is the transcript database.** A curated vault that accumulates
spawn telemetry stops being curated, and an operational store that requires human
approval per row stops being operational.

## The three connections

### 1. Brain2 → Todero — configuration, read-only

Todero reads these and treats them as authoritative. It does not redefine them,
and a divergence is a defect in Todero, not in the vault.

| What | Source | Replaces |
|---|---|---|
| Agent roster and per-agent config | `Global_Agents/<agent>/manifest.json` | parsing `AGENTS.md` from a directory outside the repo |
| Model tier by cost-of-being-wrong | `manifest.json` → `model.tier`, `claude_code_alias`, `preferred`, `fallback_local` | a single hardcoded model for every agent |
| Local-model eligibility | `manifest.json` → `local_eligible`, `compatible_with` | nothing — Todero had no concept of this |
| Severity vocabulary | `Playbooks/Severity_Levels.md` — Blocker / Critical / Important / Minor | Todero's parallel S1/S2/S3 scale |
| Loop safety contract | `Playbooks/Loop_Engineering.md` | Todero's sensorless circuit breaker and budget guard |
| User-facing terminology | `GLOSSARY.md` | UI copy inventing competing terms |

Resolve the vault path from `TODERO_VAULT_DIR`, defaulting to
`C:\Development\Mich-Brain2`. **Todero must run correctly when the vault is
absent** — a missing vault degrades to Todero's own defaults with a visible
notice naming the path it looked in. It must never crash, and must never
silently substitute invented agents.

### 2. Todero → `_pending/` — proposals only

Todero already harvests rejection reasons after a task (`post-task-memory.sh`,
TOD-489) and promotes anything repeating three or more times to a HOT tier
(`promote-hot-patterns.sh`). When a pattern clears that threshold, Todero drafts
a skill proposal into `Mich-Brain2/_pending/skill-updates/` for Michael to
approve by hand.

This is not a workaround of the read-only rule. It is the mechanism the rule
assumes, and it is what keeps `Loop_Engineering`'s hardest constraint intact:

> **No unsupervised self-modification.** An agent rewriting its own instructions
> writes a bad suggestion into permanent context, biasing every later turn.

Todero proposes. Michael approves. Brain2 stores. Todero never closes that loop
by itself, and no amount of confidence in a proposal justifies skipping the gate.

### 3. Todero → its own store — everything else

Run records, attempts, failures, token counts, costs, heartbeats, and the
episodic memory used to steer future runs all live in Todero's database. They
are retrieved by search at spawn time, ranked and budgeted — never injected
wholesale, which is what `spawn-context.sh` does today and why context bloats.

## What "aligned" means in practice

The owner's test is that Brain2 and Todero should feel like **one system**, not
two that share an operator. Concretely, that means:

- An agent named in Todero is the same agent defined in the vault, with the same
  tier and the same local-model fallback.
- A finding marked Critical in Todero means what Critical means in the vault.
- A loop in Todero obeys the same four elements as a loop in a playbook —
  verifiable exit criterion, cheap checks before model judges, hard exits with a
  no-progress halt, humans at the edges only.
- A lesson learned in Todero can become a vault skill without anyone retyping it.
