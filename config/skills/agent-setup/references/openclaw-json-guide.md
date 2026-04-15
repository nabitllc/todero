# openclaw.json — Schema & Agent Reference

File: `/Users/kemuniagent/.openclaw/openclaw.json`

## Agent Entry Schema

```json
{
  "id": "string (required)",
  "model": "string (required)",
  "workspace": "/absolute/path/to/workspace-<id>",
  "heartbeat": { "every": "30m|1h|4h|12h|24h" },
  "identity": {
    "emoji": "🔨",
    "name": "Display Name",
    "theme": "Optional theme description"
  },
  "agentDir": "/path/to/agent/dir (optional, for agents with custom agent dirs)"
}
```

Location in file: `cfg["agents"]["list"]` — array of agent objects.

## Model Guidelines

| Use case | Model |
|---|---|
| Orchestrators, complex reasoning, design review | `anthropic/claude-sonnet-4-6` |
| Heartbeat, monitoring, triage, simple tasks | `anthropic/claude-haiku-4-5` |
| Local/private (no cloud) | `ollama/gemma3:4b` |
| Auto-select | `anthropic/auto` |

## Current Agents

| ID | Model | Emoji | Name | Heartbeat | Workspace |
|---|---|---|---|---|---|
| main | claude-sonnet-4-6 | 🧠 | KAOS | 4h | workspace/ |
| scout | claude-sonnet-4-6 | 🔍 | Scout | — | workspace-scout/ |
| ops | claude-haiku-4-5 | ⚙️ | Ingo | 1h | workspace-ops/ |
| kemuni-sme | claude-haiku-4-5 | 🚀 | Kemuni SME | 4h | workspace-kemuni/ |
| vespera-sme | claude-haiku-4-5 | 🖤 | Vespera SME | 4h | workspace-vespera/ |
| builder | claude-sonnet-4-6 | 🔨 | Builder | — | workspace-builder/ |
| tester | claude-haiku-4-5 | 🧪 | Tester | — | workspace-tester/ |
| deployer | claude-haiku-4-5 | 🚀 | Deployer | 30m | workspace-deployer/ |
| auditor | claude-sonnet-4-6 | 🔍 | Auditor | — | workspace-auditor/ |
| ux | claude-sonnet-4-6 | 🎨 | UX Designer | — | workspace-ux/ |
| designer | claude-sonnet-4-6 | 🎨 | Designer | 4h | workspace-designer/ |
| po | claude-haiku-4-5 | 📋 | PO | 4h | workspace-po/ |
| growth | claude-haiku-4-5 | 📊 | Growth | 4h | workspace-growth/ |
| security | claude-sonnet-4-6 | 🔐 | Security Auditor | — | workspace-security/ |
| community | claude-haiku-4-5 | 🖤 | Community Manager | — | workspace-community/ |
| content | claude-haiku-4-5 | ✍️ | Content Creator | — | workspace-content/ |

## Adding a New Agent

1. Read the current file:
   ```bash
   cat /Users/kemuniagent/.openclaw/openclaw.json
   ```

2. Add to `agents.list` array — use Python to avoid JSON syntax errors:
   ```python
   import json
   path = '/Users/kemuniagent/.openclaw/openclaw.json'
   cfg = json.load(open(path))
   cfg['agents']['list'].append({
       "id": "my-agent",
       "model": "anthropic/claude-haiku-4-5",
       "workspace": "/Users/kemuniagent/.openclaw/workspace-my-agent",
       "heartbeat": {"every": "4h"},
       "identity": {"emoji": "🤖", "name": "My Agent"}
   })
   json.dump(cfg, open(path, 'w'), indent=2)
   print("Done")
   ```

3. Verify:
   ```bash
   python3 -c "
   import json
   cfg = json.load(open('/Users/kemuniagent/.openclaw/openclaw.json'))
   ids = [a.get('id') for a in cfg['agents']['list'] if isinstance(a, dict)]
   print('Agents:', ids)
   "
   ```

## Discord Bindings

Each agent can have a Discord channel binding in `bindings` array:
```json
{
  "agentId": "my-agent",
  "match": {
    "channel": "discord",
    "peer": {
      "kind": "channel",
      "id": "<discord-channel-id>"
    }
  }
}
```

And the channel must be allowed in `channels.discord.guilds.<guild-id>.channels`:
```json
"<channel-id>": {
  "allow": true,
  "requireMention": false
}
```

## Critical Rules
- NEVER edit this file by hand — use Python json.load/dump to preserve formatting
- NEVER run `openclaw gateway restart` — hangs in subagent context; human restarts manually
- Gateway picks up config changes on its own schedule
- All workspace paths must be absolute
