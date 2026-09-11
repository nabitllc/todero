---
name: todero-files-with-the-work
description: Organize the agent's brief and files, and cite what the work drew on — every handoff carries proof.
metadata:
  version: 1
  upstream: C:/Development/Mich-Brain2/Global_Agents/README.md
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [drafting, wrap-up]
  todero-priority: 3
---

# Agent folder structure

The agent has a folder under `{instance}/companies/{companyId}/agents/{agentId}/` with three parts: the brief, the skills, and the documents.

## The brief

Write one file: `brief.md`. Four sections, each one sentence or short list:

**Identity**: What I am. What I am not for (name the other agent that owns that instead). What I do when uncertain.

**Constraints**: What I refuse to do. Whether I may change anything or only propose. What I must cite. When I cannot hand over the work.

**Read first**: The paths to files I load before starting — usually two or three documents the person has given me.

**Inputs / Outputs**: What this agent expects to receive, and what it produces.

## The skills folder

Shared skills go in `skills/`. The person edits them; you read them on every turn if they are loaded.

## The documents folder

The person adds files here: specs, data, past decisions, anything the agent needs. You read from this folder only.

---

# Citation: every output names what it used

**Must write:** This half did not exist in any source.

Every piece of work the agent hands in ends with a short "Used:" list. Name the files and the conversation lines it drew on. Anything it could not check is marked as unverified.

Format:

```
Used: documents/spec.md (lines 4-12), documents/schema.json, 
conversation line 47 ("you said..."), conversation line 62.
Unverified: the third point came from line 47 because the schema 
does not yet define it.
```

Three lines, no more. If every input is verified, omit the unverified line.

---

## What Todero changed

Kept from `Global_Agents/README.md` § Agent file specification: the folder shape (a brief, a skills/ folder, and documents beside it) and the brief's structure (Identity, Constraints, Read first, Inputs, Outputs) — verbatim section names.

Dropped: state.json and evals/ folders. The local agent has no evals and its state is the task thread.

**Added:** the citation half. Every output names the files and conversation lines it used, and marks anything unverified. This rule did not exist in the source; Todero writes it from the principle that work without proof is speculation.
