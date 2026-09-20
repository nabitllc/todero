"""The Todero improvement loop, one wave: how far does a company get on its own?

Creates the fixed Testing Organization, drives it with a deliberately lazy
human, and prints nine numbers that each have a right answer. Exit 0 only
when every gate holds. Wave 1 is expected red: it is the baseline.

The lazy human: answers the first question once, approves the plan, never
accepts work by hand (auto-accept is on -- that is the loop's question), and
ignores any hand-back that does not actually ask for something. A task that
genuinely asks gets one lazy reply, and that reply is counted against Todero.

Order matters at set-up: governance is written BEFORE the connection test,
because a company update replaces the whole governance blob and would wipe
the window the test records. See doc/plans/2026-09-20-todero-improvement-loop.md.
"""
import json, os, re, sys, time, urllib.request, urllib.error

BASE = os.environ.get("TODERO_API", "http://127.0.0.1:3100/api")
HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = json.load(open(os.path.join(HERE, "live-loop-fixture.json"), encoding="utf-8"))

ORG = f"Zz Gauntlet Org {time.strftime('%m%d-%H%M%S')}"
OLD_MISSION = "Fill a table of five strangers for dinner in Tampa every Wednesday and Saturday."
MISSION = "Publish a one-page guide to each of four houseplants that survive a dark flat."
FIRST_ANSWER = ("Must have: the four one-page guides, each naming the plant, the light it needs, "
                "and how often to water it. Everything else can wait. Done means all four read well. "
                "Propose the plan now.")
LAZY = "Use your best judgment and hand in the output now."
BUDGET_S = int(os.environ.get("GAUNTLET_WAVE_SECONDS", "2400"))
HOLD_S = 90

START = time.time()
LOG = []
touches = {"answers_before_plan": 0, "approves": 0, "lazy_replies": 0, "hand_accepts": 0}
noise = []          # hand-backs that asked nothing
asked_for_input = []  # hand-backs that asked for a predecessor's output
pause = {"ran": False, "held": False, "runs_started_during_hold": 0}

ASKS_RE = re.compile(r"\?|\b(please|could you|can you|would you)\b.*\b(provide|send|share|give|supply|attach|paste)\b|\bi (need|require|cannot|can't)\b", re.I)
WANTS_PREDECESSOR_RE = re.compile(r"\b(without the|provide the|need the|cannot (review|complete|proceed))\b", re.I)


def call(method, path, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read().decode() or "null")
        except Exception:
            return err.code, None
    except Exception as exc:
        return 0, {"error": str(exc)}


def log(msg):
    line = f"{time.strftime('%H:%M:%S')} [{int(time.time()-START):>4}s] {msg}"
    LOG.append(line)
    print(line, flush=True)


def rows_of(d, key):
    return d if isinstance(d, list) else ((d or {}).get(key) or [])


def issues(C):
    return rows_of(call("GET", f"/companies/{C}/issues?includeBlockedBy=true")[1], "issues")


def comments(i):
    rows = rows_of(call("GET", f"/issues/{i}/comments")[1], "comments")
    rows.sort(key=lambda r: r.get("createdAt") or "")
    return rows


def documents(i):
    return rows_of(call("GET", f"/issues/{i}/documents")[1], "documents")


def runs(C):
    return rows_of(call("GET", f"/companies/{C}/heartbeat-runs?limit=80")[1], "runs")


def active(C):
    return [r for r in runs(C) if r.get("status") in ("queued", "running")]


def agent_replies(i):
    return [c for c in comments(i) if c.get("authorAgentId")]


def wait_settled(C, i, before, seconds=480):
    end = time.time() + seconds
    while time.time() < end and time.time() - START < BUDGET_S:
        if len(agent_replies(i)) > before and not active(C):
            return True
        time.sleep(10)
    return False


def setup():
    s, company = call("POST", "/companies", {"name": ORG})
    if s >= 300 or not company:
        log(f"could not create the organization: {s} {company}")
        return None, None
    C = company["id"]
    log(f"organization {ORG} -> {C}")
    # Governance FIRST: the update replaces the blob, and the connection test
    # is about to record the window into it.
    s, _ = call("PATCH", f"/companies/{C}",
                {"interactionResolverGovernance": {"autoAcceptWhenJudgePasses": True}})
    log(f"auto-accept on ({s})")
    _, goal = call("POST", f"/companies/{C}/goals", {"title": MISSION, "level": "company", "status": "active"})
    hire = json.loads(json.dumps(FIXTURE["hire"]).replace("{ORG}", ORG).replace(OLD_MISSION, MISSION))
    cfg = hire["adapterConfig"]
    s, test = call("POST", "/todero/local-llm/test",
                   {"baseUrl": cfg["localLlm"]["baseUrl"], "modelId": cfg["model"], "companyId": C}, timeout=240)
    ok = isinstance(test, dict) and test.get("ok") is True
    log(f"connection test {s} ok={ok}")
    if not ok:
        return C, None
    call("POST", f"/companies/{C}/agent-hires", hire)
    agents = rows_of(call("GET", f"/companies/{C}/agents")[1], "agents")
    if not agents:
        log("no agent hired")
        return C, None
    A = agents[0]["id"]
    _, project = call("POST", f"/companies/{C}/projects",
                      {"name": "Onboarding", "status": "in_progress", "goalIds": [goal["id"]]})
    _, root = call("POST", f"/companies/{C}/issues", {
        "title": FIXTURE["title"].replace(OLD_MISSION, MISSION),
        "description": FIXTURE["description"].replace(OLD_MISSION, MISSION),
        "assigneeAgentId": A, "projectId": project["id"], "goalId": goal["id"],
        "status": "todo", "onboardingFirstTask": True,
    })
    return C, root["id"]


def drive(C, R):
    answered_root = False
    plan_seen = False
    lazy_given = set()
    while time.time() - START < BUDGET_S:
        rows = issues(C)
        root = next((r for r in rows if r["id"] == R), None)
        children = [r for r in rows if r["id"] != R]
        open_children = [r for r in children if r.get("status") not in ("done", "cancelled")]
        acted = False

        for issue in children + ([root] if root else []):
            desc = issue.get("description") or ""
            st = issue.get("status")
            if st in ("done", "cancelled"):
                continue
            is_child = issue["id"] != R

            if "todero-plan: pending" in desc:
                s, _ = call("POST", f"/issues/{issue['id']}/plan/approve", {"keep": []}, timeout=240)
                touches["approves"] += 1
                plan_seen = True
                log(f"approved the plan ({s})")
                acted = True
                break

            if "todero-review: pending" in desc:
                # Auto-accept is on. If this sits here, a person would have had to act.
                continue

            if "waiting-on-you" in desc or st == "blocked":
                last = agent_replies(issue["id"])
                said = (last[-1].get("body") or "") if last else ""
                if not is_child and not answered_root:
                    before = len(last)
                    call("POST", f"/issues/{R}/comments", {"body": FIRST_ANSWER})
                    answered_root = True
                    touches["answers_before_plan"] += 1
                    log("answered the first question")
                    wait_settled(C, R, before)
                    acted = True
                    break
                asks = bool(ASKS_RE.search(said))
                if WANTS_PREDECESSOR_RE.search(said):
                    asked_for_input.append({"issue": issue.get("identifier"), "said": said[:200]})
                if not asks:
                    key = (issue["id"], said[:80])
                    if key not in {(n["id"], n["said"][:80]) for n in noise}:
                        noise.append({"id": issue["id"], "issue": issue.get("identifier"), "said": said[:200]})
                        log(f"hand-back with nothing asked, ignored: {issue.get('identifier')}")
                    continue
                if issue["id"] in lazy_given:
                    continue  # one lazy reply per task, then it is on Todero
                lazy_given.add(issue["id"])
                before = len(last)
                call("POST", f"/issues/{issue['id']}/comments", {"body": LAZY})
                touches["lazy_replies"] += 1
                log(f"lazy reply to {issue.get('identifier')}")
                wait_settled(C, issue["id"], before)
                acted = True
                break

        if plan_seen and not pause["ran"] and len([c for c in open_children if c.get("status") == "in_progress"]) >= 1 and not acted:
            pause["ran"] = True
            started_before = {r["id"] for r in runs(C)}
            s, _ = call("POST", "/instance/pause-all", {})
            t0 = time.time()
            log(f"PAUSE: holding for {HOLD_S}s ({s})")
            time.sleep(HOLD_S)
            t1 = time.time()
            call("POST", "/instance/resume-all", {})
            new_starts = 0
            for r in runs(C):
                if r["id"] in started_before:
                    continue
                st_at = r.get("startedAt")
                if not st_at:
                    continue
                ts = time.mktime(time.strptime(st_at[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
                if t0 <= ts <= t1:
                    new_starts += 1
            pause["runs_started_during_hold"] = new_starts
            pause["held"] = new_starts == 0
            log(f"PAUSE: runs started during the hold = {new_starts}")
            acted = True

        if acted:
            time.sleep(5)
            continue
        if root and root.get("status") == "done" and not open_children:
            log("project finished")
            return True
        time.sleep(20)
    log("budget reached")
    return False


def measure(C, R, finished):
    rows = issues(C)
    children = [r for r in rows if r["id"] != R]
    by_id = {r["id"]: r for r in rows}

    # verdicts
    verdicts, first_pass, first_seen = [], 0, set()
    for r in rows:
        for c in comments(r["id"]):
            b = c.get("body") or ""
            if "I reviewed this" in b:
                lists = ("Checked " in b) or ("did not say which" in b)
                verdicts.append(lists)
                if r["id"] not in first_seen:
                    first_seen.add(r["id"])
                    if "does what the task asked" in b:
                        first_pass += 1

    # dependency hand-off: a child that waited on another must be able to see
    # that task's output somewhere the API can see it too.
    dep_total, dep_ok = 0, 0
    for child in children:
        preds = [b for b in (child.get("blockedBy") or []) if isinstance(b, dict)]
        if not preds:
            continue
        for p in preds:
            pid = p.get("id") or p.get("issueId")
            pred = by_id.get(pid)
            if not pred:
                continue
            out = next((d for d in documents(pid) if (d.get("key") or "") == "output"), None)
            if not out:
                continue
            dep_total += 1
            snippet = " ".join((out.get("body") or "").split())[:60]
            haystack = (child.get("description") or "") + " ".join(
                (d.get("body") or "") for d in documents(child["id"]))
            if snippet and snippet in " ".join(haystack.split()):
                dep_ok += 1

    # criteria and pipeline stages
    crit_ok = 0
    stages_ok = 0
    for child in children:
        desc = child.get("description") or ""
        if re.search(r"acceptance criteria\s*\n\s*[-*]", desc, re.I):
            crit_ok += 1
        has_handin = any((d.get("key") or "") == "output" for d in documents(child["id"]))
        has_verdict = any("I reviewed this" in (c.get("body") or "") for c in comments(child["id"]))
        if has_handin and has_verdict and child.get("status") == "done":
            stages_ok += 1

    report = {
        "organization": ORG, "companyId": C, "elapsedSeconds": int(time.time() - START),
        "checks": {
            "human_answers":        {"value": touches["answers_before_plan"], "gate": "<= 1",
                                     "pass": touches["answers_before_plan"] <= 1},
            "project_completes":    {"value": finished, "gate": "true", "pass": bool(finished)},
            "dependency_handoff":   {"value": f"{dep_ok}/{dep_total}", "gate": "all",
                                     "pass": dep_total > 0 and dep_ok == dep_total},
            "noise_handbacks":      {"value": len(noise), "gate": "0", "pass": len(noise) == 0},
            "verdict_lists_checks": {"value": f"{sum(verdicts)}/{len(verdicts)}", "gate": "all",
                                     "pass": len(verdicts) > 0 and sum(verdicts) == len(verdicts)},
            "pause_holds":          {"value": pause["runs_started_during_hold"], "gate": "0 new starts",
                                     "pass": pause["ran"] and pause["held"]},
            "task_has_criteria":    {"value": f"{crit_ok}/{len(children)}", "gate": "all",
                                     "pass": len(children) > 0 and crit_ok == len(children)},
            "pipeline_stages":      {"value": f"{stages_ok}/{len(children)}", "gate": "all",
                                     "pass": len(children) > 0 and stages_ok == len(children)},
            "first_pass_rate":      {"value": f"{first_pass}/{len(first_seen)}", "gate": "trend",
                                     "pass": True},
        },
        "humanTouches": touches,
        "askedForPredecessorOutput": asked_for_input,
        "noise": noise,
        "final": {(r.get("identifier") or "?"): r.get("status") for r in rows},
    }
    return report


LAST_ORG_FILE = os.path.join(HERE, "..", "reports", "last-org.json")
RECOVER_BUDGET_S = int(os.environ.get("GAUNTLET_RECOVER_SECONDS", "900"))


def recover_previous_org():
    """Reopen the organization the previous wave left stuck, and see whether
    this wave's Todero finishes it without a person.

    A fresh organization proves a fix prevents the failure. This proves it
    rescues one -- which is what every real user gets, because their
    organization is mid-flight when Todero updates, not new.
    """
    org_id = os.environ.get("GAUNTLET_RECOVER_ORG")
    if not org_id and os.path.exists(LAST_ORG_FILE):
        try:
            org_id = json.load(open(LAST_ORG_FILE, encoding="utf-8")).get("companyId")
        except Exception:
            org_id = None
    if not org_id:
        return {"value": "no previous organization", "gate": "completes, 0 human touches", "pass": None}

    s, company = call("GET", f"/companies/{org_id}")
    if s != 200 or not company:
        return {"value": f"previous organization not found ({s})", "gate": "completes, 0 human touches", "pass": None}
    log(f"RECOVER: reopening {company.get('name')} ({org_id})")
    s, _ = call("PATCH", f"/companies/{org_id}", {"status": "active"})
    if s >= 300:
        return {"value": f"could not reopen ({s})", "gate": "completes, 0 human touches", "pass": False}

    rows = issues(org_id)
    root = next((r for r in rows if not r.get("parentId")), None)
    before_touches = dict(touches)
    t0 = time.time()
    finished = False
    lazy_here = 0
    try:
        # Same lazy human, but it never answers: the point is whether Todero
        # gets itself unstuck. A hand-back that asks is counted, not fed.
        while time.time() - t0 < RECOVER_BUDGET_S:
            rows = issues(org_id)
            open_rows = [r for r in rows if r.get("status") not in ("done", "cancelled")]
            if not open_rows:
                finished = True
                break
            for r in open_rows:
                desc = r.get("description") or ""
                if "todero-plan: pending" in desc:
                    call("POST", f"/issues/{r['id']}/plan/approve", {"keep": []}, timeout=240)
                    touches["approves"] += 1
                if ("waiting-on-you" in desc or r.get("status") == "blocked") and "todero-review: pending" not in desc:
                    last = agent_replies(r["id"])
                    said = (last[-1].get("body") or "") if last else ""
                    if ASKS_RE.search(said):
                        lazy_here += 1
            time.sleep(20)
    finally:
        call("POST", f"/companies/{org_id}/archive", {})
    log(f"RECOVER: finished={finished} hand-backs that asked={lazy_here} in {int(time.time()-t0)}s")
    return {
        "value": f"finished={finished}, asked={lazy_here}",
        "gate": "completes, 0 human touches",
        "pass": bool(finished) and lazy_here == 0,
        "organization": company.get("name"),
        "final": {(r.get("identifier") or "?"): r.get("status") for r in issues(org_id)},
    }


def remember_org(C):
    try:
        os.makedirs(os.path.dirname(LAST_ORG_FILE), exist_ok=True)
        json.dump({"companyId": C, "organization": ORG, "at": time.strftime("%Y-%m-%dT%H:%M:%S")},
                  open(LAST_ORG_FILE, "w", encoding="utf-8"))
    except Exception as exc:
        log(f"could not record the organization for the next wave: {exc}")


def main() -> int:
    C, R = setup()
    if not C:
        return 2
    try:
        if not R:
            return 2
        finished = drive(C, R)
        report = measure(C, R, finished)
    finally:
        call("POST", f"/companies/{C}/archive", {})
        log("organization archived")

    # Only after the fresh organization is archived, so the two never share
    # the one graphics card. Then this wave's organization becomes next
    # wave's recovery case.
    report["checks"]["recovers_previous_org"] = recover_previous_org()
    remember_org(C)

    print()
    print("=" * 72)
    print("WAVE REPORT")
    print("=" * 72)
    for name, c in report["checks"].items():
        mark = "PASS" if c["pass"] else ("SKIP" if c["pass"] is None else "FAIL")
        print(f"  {mark}  {name:<22} {str(c['value']):<28} (gate {c['gate']})")
    print()
    print(json.dumps(report, indent=1))
    failing = [n for n, c in report["checks"].items() if c["pass"] is False]
    return 0 if not failing else 1


sys.exit(main())
