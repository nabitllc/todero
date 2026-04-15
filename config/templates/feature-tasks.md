# Feature Task Generation Guide

> Use this when breaking a DoF-ready feature into tasks.
> Every task must meet DoR before Builder can pick it up.
> Always create tasks via MC API: POST localhost:3000/api/issues

---

## General Rules

1. One task = one focused unit of work (2-4h for Builder)
2. Every task gets: title, description, acceptance_criteria, type, priority, sprint, parent_id, severity
3. UI tasks → severity=S0. API/schema tasks → S1. Config/infra → S2. Style/copy → S3
4. Tester reviews S0 and S1 only — S2/S3 auto-pass to PR Queue
5. Order tasks so dependencies are clear — schema before API before UI

---

## By Feature Type

### UI Feature (new page, component, or visual change)
```
Task 1: [Feature] — data layer (fetch hook or API route if needed)       S1
Task 2: [Feature] — component shell + layout                              S0
Task 3: [Feature] — interactive states (loading, empty, error)            S0
Task 4: [Feature] — mobile responsive pass                                S0
Task 5: [Feature] — accessibility (keyboard nav, aria labels)             S2
```

### API Feature (new endpoint or data model)
```
Task 1: [Feature] — DB schema migration (new table or columns)            S1
Task 2: [Feature] — API route (GET/POST/PATCH/DELETE)                     S1
Task 3: [Feature] — input validation + error handling                     S1
Task 4: [Feature] — UI integration (connect frontend to endpoint)         S0
```

### Infra / Automation Feature (n8n, cron, pipeline)
```
Task 1: [Feature] — design: document workflow logic + triggers            S2
Task 2: [Feature] — n8n workflow build + test in staging                  S1
Task 3: [Feature] — error handling + retry logic                          S1
Task 4: [Feature] — alert wiring (Telegram notification on failure)       S2
```

### Bug Fix
```
Task 1: [Bug] — root cause investigation + document finding               S2
Task 2: [Bug] — fix implementation                                        S0 or S1
Task 3: [Bug] — regression test (ensure it doesn't recur)                 S1
```

---

## Example: UI Feature "Welcome Onboarding Modal"

```
Task 1: VES-50-T1 — WelcomeModal component (content, CTA, dismiss)        S0
Task 2: VES-50-T2 — localStorage persistence (show once, never repeat)    S1  
Task 3: VES-50-T3 — Mobile layout pass for modal                          S0
```

## Example: API Feature "Sprint Table"

```
Task 1: INF-159-T1 — DB: CREATE TABLE sprints + sprint_id FK on issues    S1
Task 2: INF-159-T2 — API: /api/sprints GET/POST/PATCH endpoints            S1
Task 3: INF-159-T3 — MC UI: Sprint selector in issue create/edit forms     S0
Task 4: INF-159-T4 — Backfill existing issues sprint text → sprint_id      S2
```

---

## DoR Checklist Per Task

Before submitting a task for Builder:
- [ ] `title` — specific (verb + noun, e.g. "Add back button to event detail page")
- [ ] `description` — what to build, where in codebase, technical notes
- [ ] `acceptance_criteria` — explicit pass/fail. "How does Tester verify this?"
- [ ] `type` — task / bug / ops / subtask
- [ ] `severity` — S0 / S1 / S2 / S3
- [ ] `priority` — critical / high / medium / low
- [ ] `assignee` — builder / main / tester
- [ ] `sprint` — current sprint date (YYYY-MM-DD)
- [ ] `parent_id` — the feature's issue id
