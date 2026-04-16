#!/usr/bin/env python3
"""
telegram-kaos-v2.py — Persistent-session Telegram bot for Todero/KAOS.

Uses `claude --resume <session_id> --print` for persistent conversation:
  - Same Claude subscription as Claude Code (OAuth, no API key needed)
  - Full conversation history maintained by Claude Code internally
  - Tool use (Bash, Read, Write, etc.) works in --print mode
  - Built-in context compaction handled by Claude Code

Architecture:
  1. SessionManager: one Claude session per Telegram chat_id
  2. Message handler: routes Telegram messages to the right session
  3. AlertThread: proactive pipeline checks every 5 min → KAOS group
  4. Photo handler: downloads + passes file path to Claude
"""

import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from datetime import datetime

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except ImportError:
    ET = None

# ── Configuration ───────────────────────────────────────────────────────
BOT_TOKEN = os.environ.get(
    "TELEGRAM_CLAUDE_BOT_TOKEN",
    os.environ.get("TELEGRAM_BOT_TOKEN",
                   "8792497927:AAEcRevJI2KnxlKpHochhSJj4-SviK281is")
)
BOT_NAME = "KaosClaudeBot"
ALLOWED_USERNAMES = {"iammichikyu", "msaenzcor", "GlitchSpeck"}

CLAUDE_BIN = "/Users/kemuniagent/.local/bin/claude"
WORKSPACE = "/Users/kemuniagent/todero/config"
MC_DIR = "/Users/kemuniagent/todero"
MC_API = "http://localhost:3000/api"

STATE_FILE = pathlib.Path(__file__).parent / "state-telegram-kaos-v2.json"
SESSION_DIR = pathlib.Path(__file__).parent / "sessions"
LOG_DIR = pathlib.Path(WORKSPACE) / "logs"
LOG_FILE = LOG_DIR / "telegram-kaos.log"
PHOTO_DIR = pathlib.Path("/tmp/telegram-kaos-photos")

# Alert config
ALERT_GROUP_CHAT = os.environ.get("TELEGRAM_GROUP_CHAT", "-1003598670302")
ALERT_INTERVAL = 300       # 5 minutes
ALERT_COOLDOWN = 3600      # 1 hour per alert type
SILENT_START_HOUR = 23     # 11pm ET
SILENT_END_HOUR = 7        # 7am ET

# Claude timeout: 10 minutes for complex queries
CLAUDE_TIMEOUT = 600

# ── Init ────────────────────────────────────────────────────────────────
LOG_DIR.mkdir(parents=True, exist_ok=True)
SESSION_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)


def log(msg: str):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ── Telegram helpers ────────────────────────────────────────────────────
def tg(method: str, payload: dict = {}) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"[tg:{method}] {e}")
        return {}


def send(chat_id, text: str):
    """Send a message, chunked at 4000 chars."""
    for chunk in [text[i:i + 4000] for i in range(0, len(text), 4000)]:
        tg("sendMessage", {"chat_id": chat_id, "text": chunk})


def typing(chat_id):
    """Show typing indicator."""
    tg("sendChatAction", {"chat_id": chat_id, "action": "typing"})


# ── Session Manager ─────────────────────────────────────────────────────
class SessionManager:
    """Manages one Claude Code session per Telegram chat_id."""

    def __init__(self):
        self.sessions: dict = {}  # chat_id → session_id
        self._load()

    def _state_path(self) -> pathlib.Path:
        return STATE_FILE

    def _load(self):
        """Load session mappings from disk."""
        try:
            data = json.loads(self._state_path().read_text())
            self.sessions = {int(k): v for k, v in data.get("sessions", {}).items()}
            self.allowed_chats = data.get("allowed_chat_ids", [])
            self.offsets = data.get("offsets", {})
            log(f"[sessions] loaded {len(self.sessions)} sessions")
        except Exception:
            self.sessions = {}
            self.allowed_chats = []
            self.offsets = {}

    def save(self):
        """Persist session state to disk."""
        data = {
            "sessions": {str(k): v for k, v in self.sessions.items()},
            "allowed_chat_ids": self.allowed_chats,
            "offsets": self.offsets,
        }
        tmp = self._state_path().with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.rename(self._state_path())

    def get_or_create(self, chat_id: int) -> str:
        """Get existing session ID or create a new one for this chat."""
        if chat_id in self.sessions:
            return self.sessions[chat_id]

        session_id = str(uuid.uuid4())
        self.sessions[chat_id] = session_id
        self.save()
        log(f"[sessions] created {session_id} for chat {chat_id}")

        # Initialize the session with the system prompt
        self._init_session(session_id)
        return session_id

    def _init_session(self, session_id: str):
        """Send the initial system context to a new session."""
        context = self._build_context()
        init_prompt = (
            f"You are KAOS — Michael's AI orchestrator for Todero. "
            f"You are talking via Telegram. Keep responses SHORT and mobile-friendly. "
            f"No markdown tables (Telegram doesn't render them). Be direct.\n\n"
            f"You have full access to the Todero codebase and can run any command. "
            f"When asked about pipeline state, run curl commands against {MC_API}/issues. "
            f"When asked to kick an agent, POST to {MC_API}/../run-agent?agent=X. "
            f"When asked to modify an issue, PATCH {MC_API}/issues with transitioned_by='kaos' in the body — this is your identity in the system.\n\n"
            f"<workspace-context>\n{context}\n</workspace-context>\n\n"
            f"Say: 'KAOS online. Session initialized.' — nothing else."
        )
        try:
            subprocess.run(
                [CLAUDE_BIN, "--permission-mode", "bypassPermissions",
                 "--session-id", session_id,
                 "--print", init_prompt],
                cwd=MC_DIR, capture_output=True, text=True,
                timeout=CLAUDE_TIMEOUT
            )
            log(f"[sessions] initialized {session_id}")
        except Exception as e:
            log(f"[sessions] init failed: {e}")

    def _build_context(self) -> str:
        """Load workspace context files."""
        parts = []
        today = datetime.now().strftime("%Y-%m-%d")
        for p in [
            f"{WORKSPACE}/SOUL.md",
            f"{WORKSPACE}/AGENTS.md",
            f"{WORKSPACE}/self-improving/memory.md",
            f"{WORKSPACE}/memory/{today}.md",
        ]:
            try:
                content = pathlib.Path(p).read_text().strip()
                if content:
                    parts.append(content[:5000])  # cap per file
            except Exception:
                pass
        return "\n\n---\n\n".join(parts)

    def reset(self, chat_id: int):
        """Reset a session (creates a fresh one on next message)."""
        if chat_id in self.sessions:
            old = self.sessions.pop(chat_id)
            self.save()
            log(f"[sessions] reset {old} for chat {chat_id}")


# ── Claude runner ───────────────────────────────────────────────────────
def run_claude(session_id: str, message: str, image_path: str = None) -> str:
    """Send a message to a persistent Claude session and return the response."""
    prompt = message
    if image_path:
        prompt = (
            f"{message}\n\n"
            f"[An image was attached. Read it with your Read tool: {image_path}]"
        )

    try:
        result = subprocess.run(
            [CLAUDE_BIN, "--permission-mode", "bypassPermissions",
             "--resume", session_id,
             "--print", prompt],
            cwd=MC_DIR, capture_output=True, text=True,
            timeout=CLAUDE_TIMEOUT
        )
        response = result.stdout.strip()
        if not response:
            response = result.stderr.strip()[:500] or "(empty response)"
        return response
    except subprocess.TimeoutExpired:
        return f"Timed out after {CLAUDE_TIMEOUT // 60} min. Try a simpler question."
    except Exception as e:
        return f"Error: {e}"


# ── Photo handler ───────────────────────────────────────────────────────
def download_photo(message: dict) -> str:
    """Download the largest photo from a Telegram message. Returns local path."""
    photos = message.get("photo") or []
    document = message.get("document") or {}
    file_id = None

    if photos:
        largest = max(photos, key=lambda p: p.get("file_size", 0))
        file_id = largest.get("file_id")
    elif document.get("mime_type", "").startswith("image/"):
        file_id = document.get("file_id")

    if not file_id:
        return None

    info = tg("getFile", {"file_id": file_id})
    if not info.get("ok"):
        return None

    file_path = info["result"].get("file_path")
    if not file_path:
        return None

    ext = pathlib.Path(file_path).suffix or ".jpg"
    local = PHOTO_DIR / f"tg-{int(time.time() * 1000)}{ext}"
    url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"

    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            local.write_bytes(r.read())
        log(f"[photo] saved {local} ({local.stat().st_size} bytes)")
        return str(local)
    except Exception as e:
        log(f"[photo] download failed: {e}")
        return None


# ── Proactive Alerts ────────────────────────────────────────────────────
class AlertThread(threading.Thread):
    """Background thread that checks pipeline health and sends alerts."""

    def __init__(self):
        super().__init__(daemon=True)
        self.cooldowns: dict = {}

    def run(self):
        while True:
            try:
                if not self._is_silent_hours():
                    self._check_pipeline()
            except Exception as e:
                log(f"[alerts] error: {e}")
            time.sleep(ALERT_INTERVAL)

    def _is_silent_hours(self) -> bool:
        now = datetime.now(ET) if ET else datetime.now()
        return now.hour >= SILENT_START_HOUR or now.hour < SILENT_END_HOUR

    def _can_alert(self, alert_type: str) -> bool:
        last = self.cooldowns.get(alert_type, 0)
        return time.time() - last > ALERT_COOLDOWN

    def _send_alert(self, alert_type: str, message: str):
        if not self._can_alert(alert_type):
            return
        self.cooldowns[alert_type] = time.time()
        send(ALERT_GROUP_CHAT, message)
        log(f"[alerts] sent: {alert_type}")

    def _check_pipeline(self):
        try:
            with urllib.request.urlopen(f"{MC_API}/issues", timeout=10) as r:
                issues = json.loads(r.read())
        except Exception:
            self._send_alert("server_down",
                             "🚨 Server down: cannot reach MC API")
            return

        if not isinstance(issues, list):
            return

        by_status = {}
        for i in issues:
            s = i.get("status", "?")
            by_status[s] = by_status.get(s, 0) + 1

        # Check: code_review pile-up
        cr = by_status.get("code_review", 0)
        if cr > 10:
            self._send_alert("cr_pileup",
                             f"📋 Code review backlog: {cr} items waiting")

        # Check: no one working (0 in_progress + open items exist)
        ip = by_status.get("in_progress", 0)
        open_count = by_status.get("open", 0)
        if ip == 0 and open_count > 5:
            self._send_alert("no_work",
                             f"⚠️ Pipeline idle: 0 in_progress but {open_count} open items")

        # Check: stale in_progress
        stale = []
        now_ts = datetime.now().timestamp()
        for i in issues:
            if i.get("status") == "in_progress" and i.get("started_at"):
                try:
                    st = datetime.fromisoformat(
                        i["started_at"].replace("Z", "+00:00")).timestamp()
                    if now_ts - st > 7200:  # 2 hours
                        stale.append(i.get("task_key", "?"))
                except Exception:
                    pass
        if stale:
            self._send_alert("stale_ip",
                             f"⚠️ Stale claims: {', '.join(stale[:5])} "
                             f"in_progress >2h with no live process")


# ── Authorization ───────────────────────────────────────────────────────
def authorized(message: dict, mgr: SessionManager) -> bool:
    chat_id = message.get("chat", {}).get("id")
    username = message.get("from", {}).get("username", "")
    if chat_id in mgr.allowed_chats:
        return True
    if username in ALLOWED_USERNAMES:
        if chat_id not in mgr.allowed_chats:
            mgr.allowed_chats.append(chat_id)
            mgr.save()
            log(f"Registered chat_id {chat_id} (@{username})")
        return True
    return False


# ── Message handler ─────────────────────────────────────────────────────
def handle(message: dict, mgr: SessionManager):
    chat_id = message.get("chat", {}).get("id")
    text = (message.get("text") or message.get("caption") or "").strip()
    has_photo = bool(message.get("photo")) or \
        (message.get("document", {}).get("mime_type", "").startswith("image/"))

    if not text and not has_photo:
        return

    if not authorized(message, mgr):
        log(f"Unauthorized from chat_id={chat_id}")
        send(chat_id, "Not authorized.")
        return

    username = message.get("from", {}).get("username", "?")
    log(f"[{BOT_NAME}] @{username}: {'[photo] ' if has_photo else ''}{text[:80]}")

    # Commands
    if text == "/start":
        send(chat_id,
             f"KAOS v2 online — persistent session mode.\n"
             f"Commands: /status /reset\nOr ask anything.")
        return

    if text in ("/status", "/ping"):
        now = datetime.now(ET) if ET else datetime.now()
        session_id = mgr.sessions.get(chat_id, "none")
        send(chat_id,
             f"Online | {now.strftime('%-I:%M %p ET')}\n"
             f"Session: {session_id[:8]}...")
        return

    if text == "/reset":
        mgr.reset(chat_id)
        send(chat_id, "Session reset. Next message starts a fresh conversation.")
        return

    # Download photo if present
    image_path = None
    if has_photo:
        image_path = download_photo(message)
        if not image_path:
            send(chat_id, "(could not download the photo)")
        if not text:
            text = "What do you see in this screenshot?"

    # Get or create persistent session
    session_id = mgr.get_or_create(chat_id)

    # Typing indicator in background
    stop_typing = threading.Event()

    def typing_loop():
        while not stop_typing.is_set():
            typing(chat_id)
            stop_typing.wait(4)

    typer = threading.Thread(target=typing_loop, daemon=True)
    typer.start()

    # Run Claude with persistent session
    try:
        response = run_claude(session_id, text, image_path)
    finally:
        stop_typing.set()

    log(f"[{BOT_NAME}] reply: {len(response)} chars")
    send(chat_id, response)


def handle_threaded(message: dict, mgr: SessionManager):
    """Run handle() in a background thread so polling doesn't block."""
    def runner():
        try:
            handle(message, mgr)
        except Exception as e:
            log(f"[handle] error: {e}")
    threading.Thread(target=runner, daemon=True).start()


# ── Polling loop ────────────────────────────────────────────────────────
def poll(mgr: SessionManager):
    offset = mgr.offsets.get("claude", 0)
    result = tg("getUpdates", {
        "offset": offset,
        "timeout": 25,
        "allowed_updates": ["message"]
    })
    for update in result.get("result", []):
        uid = update.get("update_id", 0)
        if update.get("message"):
            handle_threaded(update["message"], mgr)
        offset = max(offset, uid + 1)
    mgr.offsets["claude"] = offset
    mgr.save()


# ── Main ────────────────────────────────────────────────────────────────
def main():
    log("=== KAOS Telegram v2 starting ===")

    # Verify Claude CLI
    me = tg("getMe")
    if me.get("ok"):
        log(f"OK: {BOT_NAME} (@{me['result']['username']})")
    else:
        log(f"FAIL: {BOT_NAME} — bad token or network issue")
        sys.exit(1)

    mgr = SessionManager()

    # Start proactive alert thread
    alerts = AlertThread()
    alerts.start()
    log(f"[alerts] started (interval={ALERT_INTERVAL}s, cooldown={ALERT_COOLDOWN}s)")

    log(f"Polling started (timeout={CLAUDE_TIMEOUT}s, persistent sessions)")
    while True:
        try:
            poll(mgr)
        except Exception as e:
            log(f"[poll] error: {e}")
        time.sleep(1)


if __name__ == "__main__":
    main()
