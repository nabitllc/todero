---
name: issue-routing
description: Determines correct type, assignee, and hierarchy for any issue based on what needs to be done, who can do it, and where it is in the pipeline. Use before creating any issue. Also defines how assignee changes as status changes through the pipeline. NOT for: deciding what to build (that's product decisions), prioritization, or sprint planning.
---

# Issue Routing Skill

## CRITICAL: Assignee = Who Is Responsible RIGHT NOW

Assignee changes as status changes. It is NOT the person who created the issue or who last worked on it.

## Status → Assignee Auto-Transitions

When status changes, assignee must change too:

| Status Transition | New Assignee | Rule |
|---|---|---|
| → open (from backlog) | builder (tasks/bugs), SME (features) | Whoever will implement or define it |
| → in_progress | same as open | Builder/SME actively working |
| → code_review | **tester** (API auto-assigns) | Builder done — Tester owns it now |
| Tester passes (any severity) | **designer** | Designer reviews UI/UX — all issues |
| Designer approves | → approved | Both passed, ready for deploy |
| Designer rejects | **builder** + status=open | Back to Builder to fix |
| Tester fails | **builder** + status=open | Back to Builder to fix |

Review depth scales with severity — S0=full, S1=focused, S2=spot-check, S3=sanity.

**Builder should NEVER be assignee when status=code_review or beyond.**
**Tester should NEVER be assignee when status=open or in_progress.**

## Hierarchy

```
Epic (multi-sprint theme, no parent needed)
  └── Feature (shippable capability, has AC, SME defines)
       └── Task (1-2 days implementable unit, Builder implements)
       └── Bug (defect, Builder fixes)
Ops (infrastructure/config, standalone, no parent needed)
```

## Type Decision Tree

1. Multi-week, multiple features? → **Epic**
2. Shippable capability with demo + AC? → **Feature**
3. Single implementable unit (1-2 days)? → **Task** (needs parent Feature or standalone=true)
4. Something broken/wrong? → **Bug** (reference parent Feature if possible)
5. Config/infra/setup/cron? → **Ops** (standalone OK)
6. Research/evaluate/analyze? → **Task** (assignee=scout, standalone OK)

## Creation Routing (who gets assigned on creation)

| Type | Project | Initial Assignee | Why |
|---|---|---|---|
| feature | Vespera | vespera-sme | SME writes description + AC |
| feature | Kemuni | kemuni-sme | SME writes description + AC |
| feature | Mission Control | builder | Builder also defines MC features |
| feature | Infrastructure | builder | Infra features go to builder |
| task/bug | any | builder | Implementation work |
| ops | any | ops | Infrastructure operations |
| task (research) | any | scout | Scout researches |
| requires manual action | any | michael | Human-only actions |
| epic | any | po | PO structures hierarchy |

## Severity (set on creation — determines review depth)

| Type + Project | Severity | Review Depth |
|---|---|---|
| feature, Vespera or Kemuni | S0 | Tester: full DoD → Designer: full audit |
| feature, Mission Control / Infra | S1 | Tester: focused → Designer: functional check |
| task, any | S1 | Tester: focused → Designer: functional check |
| ops, any | S2 | Tester: spot-check → Designer: quick pass |
| bug, priority=critical/high | S1 | Tester: focused → Designer: functional check |
| bug, priority=medium/low | S2 | Tester: spot-check → Designer: quick pass |

All issues go through Tester + Designer. No skipping.

## P0/P1 Review Gate (MC-369)

When a P0/P1 issue moves to `in_review`, `scripts/review-gate.py` auto-creates two child review issues:

| Child | Assignee | Title Prefix | Purpose |
|---|---|---|---|
| Tester review | tester | `[Review:Tester]` | Verify AC + DoD checklist |
| Designer review | designer | `[Review:Designer]` | UI/UX quality gate |

**Done-block rule:** Parent cannot move to `done` until both review children have `test_status=passed` or `status=done`. If parent is set to `done` prematurely, the gate reverts it to `in_review`.

**Idempotency:** Children are matched by title prefix + parent_id. The script won't create duplicates.

## Validation Rules

- Task: MUST have parent_id OR standalone=true in description
- Feature: MUST have description + acceptance_criteria before status=open
- Bug: SHOULD reference parent Feature via parent_id
- Ops: no parent required
- Never create a Task assigned to tester, designer, or michael (unless type=manual)
- Never create in_review issues assigned to builder

## Examples

1. "Add contact form to Vespera" → Feature (vespera-sme, P0) → tasks under it → builder
2. "Fix login button broken" → Bug (builder, P1 or P2 by priority), ref Auth feature
3. "Set up Stripe webhook" → Ops (ops, P2)
4. "Research Kemuni competitors" → Task (scout, P2, standalone=true)
5. "Build entire billing system" → Epic → Features → Tasks
