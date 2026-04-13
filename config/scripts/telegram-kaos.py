#!/usr/bin/env python3
import json, pathlib, subprocess, sys, time, urllib.request
from datetime import datetime

BOTS = {
    "claude": {
        "token": os.environ.get("TELEGRAM_CLAUDE_BOT_TOKEN", os.environ.get("TELEGRAM_BOT_TOKEN", "8792497927:AAEcRevJI2KnxlKpHochhSJj4-SviK281is")),
        "name": "KaosClaudeBot",
        "engine": "claude",
    },
    "gpt": {
        "token": os.environ.get("TELEGRAM_GPT_BOT_TOKEN", "8751778428:AAHkfR3s0bVsFUyS3dH8LyZPgfmAXji90DU"),
        "name": "KaosGPTBot",
        "engine": "gpt",
    },
}
ALLOWED_USERNAMES = {"iammichikyu", "msaenzcor", "GlitchSpeck"}
CLAUDE_BIN = "/Users/kemuniagent/.local/bin/claude"
OPENROUTER_API_KEY = "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"
GPT_MODEL = "openai/gpt-4o"
WORKSPACE = "/Users/kemuniagent/todero/config"
MC_DIR = "/Users/kemuniagent/todero"
STATE_FILE = pathlib.Path(__file__).parent / "state-telegram-kaos.json"
LOG_DIR = pathlib.Path.home() / "todero/config" / "logs"
LOG_FILE = LOG_DIR / "telegram-kaos.log"

LOG_DIR.mkdir(parents=True, exist_ok=True)

def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def load_state():
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except: pass
    return {"offsets": {}, "allowed_chat_ids": []}

def save_state(s): STATE_FILE.write_text(json.dumps(s, indent=2))

def tg(token, method, payload={}):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"[tg:{method}] {e}"); return {}

def send(token, chat_id, text):
    for chunk in [text[i:i+4000] for i in range(0, len(text), 4000)]:
        tg(token, "sendMessage", {"chat_id": chat_id, "text": chunk})

def authorized(message, state):
    allowed = state.get("allowed_chat_ids", [])
    chat_id = message.get("chat", {}).get("id")
    username = message.get("from", {}).get("username", "")
    if chat_id in allowed: return True
    if username in ALLOWED_USERNAMES:
        if chat_id not in allowed:
            allowed.append(chat_id)
            state["allowed_chat_ids"] = allowed
            save_state(state)
            log(f"Registered chat_id {chat_id} (@{username})")
        return True
    return False

def load_context():
    parts = []
    for p in [f"{WORKSPACE}/SOUL.md", f"{WORKSPACE}/AGENTS.md",
              f"{WORKSPACE}/self-improving/memory.md",
              f"{WORKSPACE}/memory/{datetime.now().strftime('%Y-%m-%d')}.md"]:
        try:
            content = pathlib.Path(p).read_text().strip()
            if content: parts.append(content)
        except: pass
    return "\n\n---\n\n".join(parts)

def build_prompt(msg):
    return (f"<workspace-context>\n{load_context()}\n</workspace-context>\n\n"
            f"You are KAOS — Michael's AI orchestrator. He is messaging from Telegram on his phone.\n"
            f"MC API: http://localhost:3000/api/issues\n"
            f"Keep responses SHORT and mobile-friendly. No tables. No filler.\n\n"
            f"Michael says: {msg}")

def run_claude(p):
    try:
        r = subprocess.run(
            [CLAUDE_BIN, "--permission-mode", "bypassPermissions", "--print", p],
            cwd=MC_DIR, capture_output=True, text=True, timeout=120)
        return r.stdout.strip() or r.stderr[:300] or "Done"
    except subprocess.TimeoutExpired: return "Timed out"
    except Exception as e: return f"Error: {e}"

def run_gpt(p):
    data = json.dumps({
        "model": GPT_MODEL,
        "messages": [{"role": "user", "content": p}],
        "max_tokens": 1000
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions", data=data,
        headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                 "Content-Type": "application/json",
                 "HTTP-Referer": "https://kaos.nabit.work"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())["choices"][0]["message"]["content"].strip()
    except Exception as e: return f"GPT error: {e}"

def handle(token, name, engine, message, state):
    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "").strip()
    if not text: return
    if not authorized(message, state):
        log(f"Unauthorized from chat_id={chat_id}")
        send(token, chat_id, "Not authorized."); return
    log(f"[{name}] {text[:80]}")
    if text == "/start":
        send(token, chat_id,
             f"KAOS online ({'Claude' if engine=='claude' else 'GPT-4o'})\n\n"
             f"Commands: /status /issues /sprint\nOr ask anything."); return
    if text in ("/status", "/ping"):
        send(token, chat_id, f"Online | {engine.upper()} | {datetime.now().strftime('%-I:%M %p ET')}"); return
    if text in ("/issues", "/board"):
        text = "What issues are open or in progress right now? Keep it brief."
    if text == "/sprint":
        text = "Current sprint status? Done, in progress, blocked? Short."
    tg(token, "sendChatAction", {"chat_id": chat_id, "action": "typing"})
    p = build_prompt(text)
    response = run_claude(p) if engine == "claude" else run_gpt(p)
    log(f"[{name}] reply: {len(response)} chars")
    send(token, chat_id, response)

def poll(bot_key, bot, state):
    token = bot["token"]
    offset = state.get("offsets", {}).get(bot_key, 0)
    result = tg(token, "getUpdates", {"offset": offset, "timeout": 25, "allowed_updates": ["message"]})
    for update in result.get("result", []):
        uid = update.get("update_id", 0)
        if update.get("message"):
            handle(token, bot["name"], bot["engine"], update["message"], state)
        offset = max(offset, uid + 1)
    state.setdefault("offsets", {})[bot_key] = offset
    save_state(state)

log("=== KAOS Telegram starting ===")
for k, b in BOTS.items():
    me = tg(b["token"], "getMe")
    if me.get("ok"):
        log(f"OK: {b['name']} (@{me['result']['username']})")
    else:
        log(f"FAIL: {b['name']} — bad token or network issue")

log("Polling started")
while True:
    state = load_state()
    for k, b in BOTS.items():
        try: poll(k, b, state)
        except Exception as e: log(f"[{b['name']}] poll error: {e}")
    time.sleep(1)
