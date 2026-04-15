# Todero — Product PRD (legacy name: KAOS Mission Control)
**Version:** 0.1 — 2026-03-29
**Owner:** Michael Saenz, Nabit LLC
**Status:** Draft — Beta v1 target

---

## 1. The Problem

Solo founders and small business owners are stuck in execution. They have a vision but spend 90% of their time on tasks that don't require their judgment — writing code, managing contractors, tracking progress, answering the same questions, testing features. AI tools exist but they're disconnected: one tool writes code, another manages tasks, another handles email, nothing talks to each other. The founder ends up being the integration layer — exhausting, doesn't scale.

Existing solutions fail because:
- **Jira/Linear/Asana** — task tracking, no execution. Still need humans to do the work.
- **Zapier/n8n** — automation, not intelligence. Can't reason, can't adapt, can't build.
- **Cursor/Copilot** — coding assistants, not business operators. Single task, not company-wide.
- **Paperclip** — closest competitor, open source, but no business model, no templates, no mobile, no non-technical UX.

---

## 2. The Vision

KAOS Mission Control is the operating system for a 1-human company. The human sets vision and intention. Agents handle execution 24/7. The human's job becomes: approve, redirect, and grow.

> "I want to be able to tell KAOS what I want to build, and come back to review results — not manage every step."
> — Michael Saenz, founder

**The promise:** Any founder — technical or not — can run a real business with AI agents doing the execution work, reviewed and directed from their phone in minutes per day.

---

## 3. Target Users

### Primary: Solo founders & solopreneurs (US + Colombia, expanding globally)
- Building their first or second product
- Have a vision but limited time/money to hire
- Comfortable using chat (WhatsApp, Telegram) as a control surface
- Examples: indie hackers, bootstrapped SaaS founders, freelancers productizing their service

### Secondary: Small teams (2-5 people)
- Want to punch above their weight
- Currently using a mix of contractors + AI tools
- Want one system instead of 5

### Beta users (real, known):
- **Michael** — Kemuni (property mgmt SaaS) + Vespera (goth community app)
- **Sister (ZNZ Express)** — trucking company, dispatch + invoicing + compliance
- **Mom** — art business, Etsy/Shopify + social content + orders
- **Friend (Montescala)** — whisky brand, content + distributor tracking + events

---

## 4. Core Jobs To Be Done

1. **"I want to build a new feature without writing a single line of code"** — describe it in plain language, agents spec + build + test it
2. **"I want to know what's happening in my business without logging into 5 tools"** — one glass cockpit, updated 24/7
3. **"I want someone working on my business while I sleep"** — agents run autonomously, only escalate when a human decision is needed
4. **"I want to pivot fast without firing anyone"** — pause a project, start another, agents adapt immediately
5. **"I want to start a new business type I know nothing about"** — import a template, agents already know the domain

---

## 5. Product Overview

### 5.1 The Agent Team
Every MC instance comes with a configurable team of AI agents:

| Agent | Role | Always included |
|---|---|---|
| KAOS (Orchestrator) | Sets priorities, routes work, talks to human | ✅ |
| Builder | Writes and ships code | Optional |
| Tester | QA, acceptance review | Optional |
| Ingo | Infrastructure monitoring | Optional |
| Growth | Metrics, activation, feedback | Optional |
| Scout | Research, competitive intel | Optional |
| [Product SME] | Domain expert per project | 1 per project |

Non-technical businesses (trucking, art, whisky) use a different agent set:
- **Ops Agent** → handles scheduling, logistics, compliance reminders
- **Content Agent** → social posts, product descriptions, customer emails
- **Finance Agent** → invoice tracking, expense categorization, payment follow-ups
- **Support Agent** → customer inquiry handling

### 5.2 The Control Surfaces
Three ways to interact with MC, all equal:
1. **Web dashboard** (Mission Control UI) — full visibility, all tabs
2. **Telegram/WhatsApp** — daily check-in, quick approvals, alerts
3. **API** — for technical users who want to integrate

### 5.3 Core Tabs (current + roadmap)
| Tab | Status | Description |
|---|---|---|
| Overview | ✅ Live | Company health, sprint progress, risk radar |
| Board | ✅ Live | Kanban — all issues by status |
| Issues | ✅ Live | Full issue list + filters |
| Features | ✅ Live | Feature pipeline, DoF status |
| Epics | ✅ Live | Epic-level grouping |
| Pipeline | ✅ Live | Factory floor — Builder→Tester→PR flow |
| Activity | ✅ Live | Agent sessions, audit log |
| Agents | ✅ Live | Roster, status, token usage |
| Automations | ✅ Live | n8n workflows, cron schedules |
| Chat | ✅ Live | Talk directly to any agent |
| Goals | 🔲 Roadmap | Company mission → quarterly goals → sprints |
| Revenue | 🔲 Roadmap | MRR, users, activation, churn |
| Templates | 🔲 Roadmap | Pre-built company configs |
| Hire | 🔲 Roadmap | Visual agent hiring screen |

---

## 6. Beta v1 Scope (for Michael + 10 users)

### Must have for beta:
- [ ] Multi-tenant: each user has isolated agents, issues, projects
- [ ] Onboarding flow: "What kind of business do you have?" → suggests agent team + first sprint
- [ ] At least 4 templates: SaaS startup, E-commerce/creator, Professional services/logistics, CPG/brand
- [ ] Mobile-friendly web UI (no app needed for v1)
- [ ] Telegram integration out of the box (primary mobile surface)
- [ ] Payment: Stripe subscription ($49/mo Founder, $149/mo Studio)
- [ ] Agent token usage tracking per tenant (so costs are visible)
- [ ] Basic audit log (what did agents do today)

### Cut for beta:
- Revenue share enforcement (manual for now)
- Open source release
- WhatsApp (Telegram first, WhatsApp v2)
- Mobile app
- Marketplace / template store

---

## 7. Business Model

### Pricing

| Plan | Price | Limits | Target |
|---|---|---|---|
| **Founder** | $49/mo | 1 user, 3 projects, 5 agents | Solo founder, first business |
| **Studio** | $149/mo | 3 users, unlimited projects, all agents | Small team or 2-3 businesses |
| **Revenue share** | +2% MRR | Premium support, onboarding included | Power users who want alignment |

### Path to $10K MRR (Month 3 target):
- 67 Founder plan users = $10K — needs ~500 signups with 13% conversion
- 34 Studio plan users = $10K — needs ~250 signups with 14% conversion
- **Most realistic:** 40 Founder + 15 Studio = $4,145 — then grow from beta word of mouth

### Revenue projections:
- Month 1: 5 beta users (friends/family), $0-245 (some comped)
- Month 2: 20 users, $980/mo — launch on Product Hunt, Twitter
- Month 3: 60 users, $4-6K/mo — first paid acquisition
- Month 6: 150 users, $12K/mo — templates driving organic

### Secondary revenue:
- **Setup service**: $299-499 one-time — MC configured for your business type (high margin, builds case studies)
- **Agent hours**: Future — sell pre-configured agent bundles for specific industries

---

## 8. Go-To-Market

### Phase 1 — Beta (Month 1-2)
- 5-10 users: Michael's family + friends network
- Goal: prove it works for non-technical users (trucking, art, whisky)
- No public launch yet — refine onboarding and templates

### Phase 2 — Launch (Month 2-3)
- Product Hunt launch
- Twitter/X: document the journey publicly ("running 3 businesses with 0 employees")
- Target: IndieHackers, r/SaaS, r/entrepreneur communities
- Colombia: WhatsApp-first outreach to founders community (La Haus, Platzi alumni network)

### Phase 3 — Growth (Month 3-6)
- Templates as SEO: "AI agents for trucking company", "AI agents for Etsy seller"
- YouTube/TikTok: "watch my AI agents build my app while I sleep"
- Referral program: 1 month free per referred paying user

---

## 9. What Makes KAOS MC Different

| Feature | KAOS MC | Paperclip | Linear | Zapier |
|---|---|---|---|---|
| Agents actually execute work | ✅ | ✅ | ❌ | Partial |
| Non-technical friendly | ✅ | ❌ | ❌ | Partial |
| Mobile-first (Telegram/WhatsApp) | ✅ | ❌ | ❌ | ❌ |
| Sprint discipline + pipeline | ✅ | ❌ | ✅ | ❌ |
| Revenue visibility | ✅ (roadmap) | ❌ | ❌ | ❌ |
| Templates for business types | ✅ (roadmap) | ✅ | ❌ | ✅ |
| Works for non-SaaS businesses | ✅ | Partial | ❌ | ✅ |
| Hosted (no self-install) | ✅ | ❌ | ✅ | ✅ |

---

## 10. Open Source Strategy

Recommendation: **Open core, not fully open**.

- Core orchestration engine → open source (MIT license)
- Hosted platform + templates + mobile surface + analytics → paid only
- This builds trust, community contributions, and SEO without giving away the business

Timeline: open source the core after reaching $10K MRR — use it as a growth lever, not a day-one decision.

---

## 11. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Non-technical users find setup too hard | High | Conversational onboarding, templates, setup service |
| LLM costs make unit economics bad | Medium | Token usage tracking per tenant, model optimization (haiku for ops, sonnet for building) |
| Paperclip or Linear adds agents | Medium | Move fast, win on non-technical UX and mobile |
| Legal: revenue share creates partnership liability | Low | Clear T&Cs, platform fee framing, legal review before v2 |
| Beta users (family) don't actually use it | Medium | Hands-on onboarding for each, weekly check-in |

---

## 12. Open Questions (to resolve before beta launch)

- [ ] What is the brand name? "KAOS Mission Control" is internal — what do customers call it?
- [ ] Delaware LLC or repurpose existing Nabit LLC entity?
- [ ] Stripe setup: which entity receives payments?
- [ ] For non-SaaS businesses (trucking, art): which agents replace Builder/Tester?
- [ ] WhatsApp Business API for LATAM users — cost and setup complexity?
- [ ] Beta pricing: comp family/friends fully or charge them something (even $1 creates accountability)?

---

## 13. Beta Onboarding Script (for Michael's network)

When onboarding sister (trucking), mom (art), friend (whisky):
1. "What does your business do in one sentence?"
2. "What takes you the most time every week that you wish someone else handled?"
3. "What would you check every morning to know your business is healthy?"

Answers → agent team suggestion → first sprint goal → 15-min setup call.

---

*Document last updated: 2026-03-29*
*Next review: when beta users are identified and onboarding begins*
