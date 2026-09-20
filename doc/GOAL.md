# Todero

**Todero is the backbone of the autonomous economy.** We are building the infrastructure that autonomous AI companies run on. Our goal is for Todero-powered companies to collectively generate economic output that rivals the GDP of the world's largest countries. Every decision we make should serve that: make autonomous companies more capable, more governable, more scalable, and more real.

## The Vision

Autonomous companies — AI workforces organized with real structure, governance, and accountability — will become a major force in the global economy. Not one company. Thousands. Millions. An entire economic layer that runs on AI labor, coordinated through Todero.

Todero is not the company. Todero is what makes the companies possible. We are the control plane, the nervous system, the operating layer. Every autonomous company needs structure, task management, cost control, goal alignment, and human governance. That's us. We are to autonomous companies what the corporate operating system is to human ones — except this time, the operating system is real software, not metaphor.

The measure of our success is not whether one company works. It's whether Todero becomes the default foundation that autonomous companies are built on — and whether those companies, collectively, become a serious economic force that rivals the output of nations.

## The person owns the company. The agents run it.

A Todero company should need no human inside its daily operations. Agents take the work, break it down, do it, check each other, and finish it. The person is not a step in that loop and is not asked to confirm each move.

Two decisions stay human, always: **what the company is for** — the strategy, the goals, what counts as done — and **real money** — what may be spent, on what, and when to stop. Everything between those two belongs to the agents, and Todero's job is to make that stretch safe enough to leave alone.

The measure is how long a company runs with nobody in the loop, how few decisions reach the person, and how sure they are that the ones that do reach them are exactly the ones that should. Zero-human operations is easy if you simply stop asking; the hard version is earning the silence.

## Where we start

A category is not a way in. Todero's way in — the one job it should be famously best at — is this:

> **An AI team that plans and writes your company's documents overnight, on hardware you control, where nothing leaves the building.**

Three reasons this one and not another. It is **true today** rather than promised: a company on a local model goes from a mission to finished, reviewed documents without a person in the loop. **Local-first is a buying reason**, not a nicety, for anyone who cannot send their work to a vendor. And it makes code work the **expansion** rather than the entry, so we sell what exists.

The governance layer — budgets, approvals, reviewers, the org chart, the audit trail — is the deeper moat, and it is what makes the second conversation. It is not the first one: nobody buys an audit trail for agents before they have watched agents produce something worth auditing.

## The Problem

Task management software doesn't go far enough. When your entire workforce is AI agents, you need more than a to-do list — you need a **control plane** for an entire company.

## What This Is

Todero is the command, communication, and control plane for a company of AI agents. It is the single place where you:

- **Manage agents as employees** — hire, organize, and track who does what
- **Define org structure** — org charts that agents themselves operate within
- **Track work in real time** — see at any moment what every agent is working on
- **Control costs** — token salary budgets per agent, spend tracking, burn rate
- **Align to goals** — agents see how their work serves the bigger mission
- **Preserve work context** — comments, documents, work products, attachments, and company state stay attached to the work

## Architecture

Two layers:

### 1. Control Plane (this software)

The central nervous system. Manages:

- Agent registry and org chart
- Task assignment and status
- Budget and token spend tracking
- Issue comments, documents, work products, attachments, and company state
- Goal hierarchy (company → team → agent → task)
- Heartbeat monitoring — know when agents are alive, idle, or stuck

It also enforces execution-control semantics such as single-assignee issues, atomic checkout and execution locks, blockers, recovery issues, and workspace/runtime controls.

### 2. Execution Services (adapters)

Agents run externally and report into the control plane. Adapters connect different execution environments and define how a heartbeat is invoked, observed, and cancelled:

- **Local CLI/session adapters** — built-in adapters for tools such as Claude Code, Codex, Gemini, OpenCode, Pi, and Cursor
- **HTTP/process-style adapters** — command or webhook/API integrations for custom runtimes
- **OpenClaw gateway** — integration for OpenClaw-style remote agents
- **External adapter plugins** — dynamically loaded adapters installed outside the core app

The control plane doesn't run agents. It orchestrates them. Agents run wherever they run and phone home.

## Core Principle

You should be able to look at Todero and understand your entire company at a glance — who's doing what, how much it costs, and whether it's working.
