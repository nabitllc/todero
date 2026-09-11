"""The live loop on a local model, driven through the server's routes.

Creates a throwaway organization the way the wizard does (organization, mission
goal, connection test, hire, Onboarding project, first task), answers the
agent's questions once, expects a plan within two rounds, approves it, accepts
each hand-in after the reviewer's verdict, and expects the wrap-up, the
completed project and the achieved feature goals. Archives the organization
at the end, pass or fail. Exit 0 only when every expectation held.

Needs the dev server on 127.0.0.1:3100 and Ollama with the fixture's model.
"""
import json
import os
import re
import sys
import time
import urllib.request
from collections import Counter

BASE = os.environ.get("TODERO_API", "http://127.0.0.1:3100/api")
HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = json.load(open(os.path.join(HERE, "live-loop-fixture.json"), encoding="utf-8"))
ORG = f"Zz Gauntlet {time.strftime('%m%d-%H%M%S')}"
MISSION = "Fill a table of five strangers for dinner in Tampa every Wednesday and Saturday."
ANSWER = ("Must have: the one-page concept, the sign-up flow, the matching rules, and a shortlist of ten restaurants. "
          "Everything else can wait. Done means all four documents exist and read well. Propose the plan now.")
CHILD_ANSWER = "Use your best judgment and hand in the output now."
FAILURES: list[str] = []


def call(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read().decode() or "null")
        except Exception:
            return err.code, None


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def expect(condition, message):
    if not condition:
        FAILURES.append(message)
        log("FAIL " + message)


def wait_for(pred, seconds, every=8):
    deadline = time.time() + seconds
    while time.time() < deadline:
        value = pred()
        if value:
            return value
        time.sleep(every)
    return None


def issues_of(company):
    _, rows = call("GET", f"/companies/{company}/issues?includeBlockedBy=true")
    return sorted(rows or [], key=lambda r: int(r["identifier"].split("-")[1]))


def comments(issue_id):
    _, d = call("GET", f"/issues/{issue_id}/comments")
    return d if isinstance(d, list) else (d or {}).get("comments", [])


def markers(desc):
    desc = desc or ""
    return {
        "waiting": bool(re.search(r"todero-blocked-by:\s*waiting-on-you", desc)),
        "review": bool(re.search(r"todero-review:\s*pending", desc)),
        "plan": bool(re.search(r"todero-plan:\s*pending", desc)),
    }


def main() -> int:
    status, company = call("POST", "/companies", {"name": ORG})
    if status >= 300 or not company:
        log(f"could not create the organization: {status}")
        return 1
    C = company["id"]
    log(f"organization {ORG} {C}")
    try:
        status, goal = call("POST", f"/companies/{C}/goals", {"title": MISSION, "level": "company", "status": "active"})
        expect(status == 201, f"mission goal created ({status})")
        hire = FIXTURE["hire"]
        model = hire["adapterConfig"]["model"]
        base_url = hire["adapterConfig"]["localLlm"]["baseUrl"]
        status, test = call("POST", "/todero/local-llm/test", {"baseUrl": base_url, "modelId": model, "companyId": C}, timeout=180)
        expect(status == 200 and isinstance(test, dict) and test.get("ok") is True, f"connection test passed ({status} {test and test.get('error')})")
        hire_body = json.loads(json.dumps(hire).replace("{ORG}", ORG))
        status, _ = call("POST", f"/companies/{C}/agent-hires", hire_body)
        expect(status == 201, f"hire accepted ({status})")
        agents = call("GET", f"/companies/{C}/agents")[1] or []
        expect(len(agents) == 1, f"one agent hired ({len(agents)})")
        if not agents:
            return 1
        A = agents[0]["id"]
        status, project = call("POST", f"/companies/{C}/projects", {"name": "Onboarding", "status": "in_progress", "goalIds": [goal["id"]]})
        expect(status == 201, f"project created ({status})")
        status, issue = call("POST", f"/companies/{C}/issues", {
            "title": FIXTURE["title"], "description": FIXTURE["description"], "assigneeAgentId": A,
            "projectId": project["id"], "goalId": goal["id"], "status": "todo", "onboardingFirstTask": True,
        })
        expect(status == 201, f"first task created ({status})")
        root = issue

        # 1) the agent asks, the person answers once, the plan arrives within two rounds
        plan_round = None
        for round_ in range(1, 4):
            wait_for(lambda: len([c for c in comments(root["id"]) if c.get("authorAgentId")]) >= round_ + 1, 240)
            current = call("GET", f"/issues/{root['id']}")[1] or {}
            m = markers(current.get("description"))
            log(f"round {round_}: status={current.get('status')} markers={m}")
            if m["plan"]:
                plan_round = round_
                break
            call("POST", f"/issues/{root['id']}/comments", {"body": ANSWER})
        expect(plan_round is not None and plan_round <= 2, f"plan proposed within two rounds (round {plan_round})")
        if plan_round is None:
            return 1

        # 2) approve; children in To do, chained
        status, approved = call("POST", f"/issues/{root['id']}/plan/approve", {"keep": []})
        expect(status == 201, f"plan approved ({status})")
        children = [i for i in issues_of(C) if i.get("parentId") == root["id"]]
        expect(4 <= len(children) <= 12, f"children created ({len(children)})")
        expect(all(c["status"] == "todo" for c in children), "children start in To do")
        reviewer = next((a["id"] for a in (call("GET", f"/companies/{C}/agents")[1] or []) if a.get("role") == "reviewer"), None)
        expect(reviewer is not None, "a reviewer was hired on approval")

        # 3) each child: hand-in, reviewer verdict, accept; answer a question at most twice
        for _ in range(len(children)):
            open_children = [i for i in issues_of(C) if i.get("parentId") == root["id"] and i["status"] not in ("done", "cancelled")]
            if not open_children:
                break
            child = open_children[0]
            cid, ident = child["id"], child["identifier"]
            answers = 0
            for _attempt in range(6):
                got = wait_for(lambda: (lambda r: r if (r["status"] in ("done", "cancelled") or markers(r.get("description"))["review"] or markers(r.get("description"))["waiting"]) else None)(call("GET", f"/issues/{cid}")[1] or {"status": "?"}), 300)
                if not got:
                    expect(False, f"{ident}: no hand-in or question within 5 minutes")
                    break
                m = markers(got.get("description"))
                if got["status"] in ("done", "cancelled"):
                    break
                if m["review"]:
                    verdict = wait_for(lambda: [c for c in comments(cid) if c.get("authorAgentId") == reviewer] or None, 300) if reviewer else None
                    expect(bool(verdict), f"{ident}: the reviewer gave a verdict")
                    call("PATCH", f"/issues/{cid}", {"status": "done"})
                    log(f"{ident}: handed in, reviewed, accepted")
                    break
                if m["waiting"]:
                    answers += 1
                    if answers > 2:
                        expect(False, f"{ident}: still asking after two answers")
                        call("PATCH", f"/issues/{cid}", {"status": "done"})
                        break
                    call("POST", f"/issues/{cid}/comments", {"body": CHILD_ANSWER})
                    time.sleep(15)

        # 4) wrap-up: parent done, project completed, feature goals achieved
        done = wait_for(lambda: (lambda r: r if r.get("status") == "done" else None)(call("GET", f"/issues/{root['id']}")[1] or {}), 300)
        expect(bool(done), "the conversation task closed with the wrap-up")
        projects = call("GET", f"/companies/{C}/projects")[1] or []
        expect(any(p["name"] == "Onboarding" and p["status"] == "completed" for p in projects), "the Onboarding project completed")
        goals = call("GET", f"/companies/{C}/goals")[1] or []
        feature_goals = [g for g in goals if g.get("level") == "feature"]
        expect(feature_goals and all(g["status"] == "achieved" for g in feature_goals), f"feature goals achieved ({Counter(g['status'] for g in feature_goals)})")
        runs = call("GET", f"/companies/{C}/heartbeat-runs?limit=100")[1]
        runs = runs if isinstance(runs, list) else (runs or {}).get("runs") or []
        reasons = Counter(str((x.get("contextSnapshot") or {}).get("wakeReason")) for x in runs)
        expect("finish_successful_run_handoff" not in reasons, f"no handoff re-wake ({dict(reasons)})")
        log(f"runs by status: {dict(Counter(x['status'] for x in runs))}")
    finally:
        call("POST", f"/companies/{C}/archive", {})
        log(f"archived {ORG}")
    if FAILURES:
        log(f"{len(FAILURES)} expectation(s) failed")
        return 1
    log("live loop passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
