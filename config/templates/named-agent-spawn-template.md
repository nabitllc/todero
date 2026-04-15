# Named-Agent Routing Template

Use this for every persistent named-agent handoff (`builder`, `tester`, `designer`, `scout`, `auditor`, `deployer`, `ux`, `po`).

## Rule

- If a persistent named role fits the work, route it through that named agent's session.
- Only use an anonymous subagent when there is no fitting named role or the task is intentionally temporary/special-case.

## Build the message payload

```bash
cat >/tmp/task.md <<'EOF'
[full task instructions here]
EOF

python3 /Users/kemuniagent/.openclaw/workspace/scripts/render-named-agent-task.py builder \
  --task-key TOD-XXX \
  --branch feature_branch \
  --instructions-file /tmp/task.md
```

## Send it to the named agent

```bash
openclaw agent --agent builder \
  --message "$(python3 /Users/kemuniagent/.openclaw/workspace/scripts/render-named-agent-task.py builder --task-key TOD-XXX --branch feature_branch --instructions-file /tmp/task.md)"
```

## Rendered prompt shape

```markdown
## Agent Context
...workspace-builder/SOUL.md...
...workspace-builder/AGENTS.md...
...workspace-builder/self-improving/memory.md...
...workspace-builder/self-improving/corrections.md...
...workspace-builder/self-improving/reflections.md...

## Task
Task key: TOD-XXX
Branch: feature_branch
[full task instructions here]
```

The helper already includes:
- `workspace-<agent>/SOUL.md`
- `workspace-<agent>/AGENTS.md`
- `workspace-<agent>/self-improving/memory.md`
- `workspace-<agent>/self-improving/corrections.md` (when present)
- `workspace-<agent>/self-improving/reflections.md` (when present)

So the only thing KAOS supplies is the actual assignment body.
