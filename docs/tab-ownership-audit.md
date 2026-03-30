# Tab Data Ownership Audit

## Data Types and Owning Tabs

| Data Type | Owner Tab | Also Appears In | Notes |
|-----------|-----------|-----------------|-------|
| Agent status/roster | Team | Overview (summary only) | Team shows full roster with live status dots, capabilities, models. Overview shows only attention items. |
| Task/issue lists | Board | Overview (counts only) | Board has full kanban, filters, drag-and-drop. Overview shows project health summary counts. |
| Automation schedules | Automations | — | Only Automations tab shows cron/workflow list. Calendar shows sprint dates, not automations. |
| Activity feed | Activity | — | Activity tab owns the unified feed (agent runs + issue changes). |
| Agent office visualization | Office | — | Office is the only tab with the animated floor view. |
| Memory files | Memory | — | Only Memory tab browses memory. |
| Sprint progress | Overview | — | SprintProgressCard is Overview-only. |
| Infrastructure status | Infra | Overview (subscriptions card) | Infra has full service list, usage, hardware. Overview has compact subscription/balance card. |
| Chat conversations | Chat | — | Only Chat tab. |
| Feature roadmap | Features | Board (feature grouping) | Features has roadmap view, Board can group by feature. Different presentations. |
| Pipeline | Pipeline | — | Pipeline tab only. |
| Issues (detailed) | Issues | Board | Issues tab is a table view, Board is kanban. Different views of same data. |

## Duplications Identified

### 1. Subscriptions & Balances (Overview) vs Services (Infra)
- **Decision**: Keep both. Overview shows a compact 4-card summary. Infra shows full service grid with live status, heartbeats, and token usage. They serve different purposes.

### 2. Project Health (Overview) vs Board task counts
- **Decision**: Keep both. Overview shows summary progress bars. Board shows full kanban. Overview is a dashboard summary.

### 3. Needs Attention (Overview) vs Board critical issues
- **Decision**: Keep in Overview. It surfaces critical blockers that need Michael's attention without navigating to Board.

## Ownership Rules Going Forward

- **Agent status updates**: Team tab is source of truth. Other tabs may show a summary badge but not a full agent list.
- **Task CRUD**: Board tab owns create/edit/delete. Other tabs show read-only summaries.
- **Automation management**: Automations tab owns cron display. Calendar shows time-based views only.
- **Issue detail panels**: Board and Issues tabs share the detail panel component.

## Changes Made

- No redundant displays removed (all current cross-tab data serves distinct summary vs. detail purposes).
- `michael` added as valid assignee with highlighted "Needs You" queue on Board (MC-127).
- Business → Project hierarchy added to Board's business grouping view (MC-171).
