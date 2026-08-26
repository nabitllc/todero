# pieces9 — LLM provider: the silent-empty SWEEP

**Lane files:** `lib/llm-provider.ts`, `lib/runtimes/openai-api.ts`, `app/api/chat/**`,
`scripts/lib/env-report.mjs`, this doc.
**Channels:** LLM Provider Independence · Observability & Honest Reporting.
**Benchmark:** *Runs on any machine against any OpenAI-compatible LLM API, tested with local Ollama.*
**Date of every measurement below:** 2026-08-26, this machine (Windows 11, Node 24.18.0).

The defect class, restated: **a parse failure, a non-2xx, a timeout, or an unexpected shape
collapsing into a value indistinguishable from a legitimate empty result.** The previous round
fixed it in `readModelsResponse()` and that fix is real. This round is the sweep.

---

## 1. THE COUNT — 13 collapse sites in the owned files

| # | Site | What collapsed into what | Status |
|---|---|---|---|
| 1 | `app/api/chat/route.ts` SSE relay | a body with **no SSE frames at all** → `data: {"done":true}` | **FIXED** |
| 2 | `app/api/chat/autotitle/route.ts:64` | bare `res.json()` → catch → **"is unreachable"** for a 200 | **FIXED** |
| 3 | `app/api/chat/autotitle/route.ts:66` | wrong shape **and** empty model output → one `"No title generated"` | **FIXED** |
| 4 | `app/api/chat/search/route.ts:22` | query `error` discarded → HTTP 200 `[]` = "no matches" | **FIXED** |
| 5 | `lib/llm-provider.ts` `readModelsResponse` | `{"data":[],"error":{…}}` → `{ok:true,models:[]}` → "pull one first" | **FIXED** |
| 6 | `lib/runtimes/openai-api.ts:178` `probeProvider` | all 3 kinds → `"<url> does not answer"`, `kind` erased | **FIXED** |
| 7 | `scripts/lib/env-report.mjs` `llmStatus()` | `live.kind` dropped on the floor | **FIXED** |
| 8 | `scripts/lib/env-report.mjs` `probeOpenAiShape()` | 3rd hand-rolled parser; **HTTP 401 → "answering a different API"** | **FIXED** |
| 9 | `app/api/chat/send-to-agent/route.ts:53` | kick 404 / throw / success → all `"nudged"` | **FIXED** |
| 10 | `lib/llm-provider.ts` `noModelsError()` | Ollama-only advice for **every** endpoint | **FIXED** |
| 11 | `lib/runtimes/openai-api.ts` `fetchModelsFrom` | divergent branch missing `cache:'no-store'` | **FIXED** |
| 12 | `lib/llm-provider.ts` `fetchLiveModels` | ungated Ollama enrichment: **62 requests** per dropdown | **FIXED** |
| 13 | `fetchServedContextLengths` / `fetchTrainedContextLength` | non-2xx / throw → "unknown", same as "not loaded" | **REPORTED, not changed** — see §7 |

Ten of these are the defect class proper. Three (10, 11, 12) are the same dishonesty in a
different costume: confidently wrong advice, a verdict that can go stale, and work done against
an API the endpoint does not have.

---

## 2. THE BIGGEST FINDING — the chat stream itself, and the critic did not have it

The critic's "biggest gap" was `probeProvider()` flattening `kind`. That is real (§3) and it is
fixed. But the worst instance of the class was on the **loudest surface in the product** and went
unreported.

`app/api/chat/route.ts` skipped every line it could not parse. So an upstream that answered
`200` with anything that is not an OpenAI SSE stream emitted **zero** delta frames and then the
ordinary terminator.

**MEASURED** — real HTTP servers, real sockets, the real route handler, before the fix:

```
upstream = 200 text/html (a proxy login page)
  route returns:  data: {"done":true}

upstream = 200 application/json, a correct NON-streaming completion
            {"choices":[{"message":{"content":"PONG"}}]}
  route returns:  data: {"done":true}

upstream = 200 text/event-stream, only malformed data: lines
  route returns:  data: {"done":true}
```

All three are **byte-identical to a model that legitimately replied with an empty string.** In
the second case the answer `PONG` is sitting in the response body; the relay simply could not
see it. The user gets an empty assistant bubble and no error anywhere in the product.

**The fix.** `sawFrame` — *not* `fullContent` — is the discriminator, because a legitimately
empty completion still arrives as well-formed SSE frames and must stay a clean `done`. After:

```
200 text/html    -> data: {"error":"http://127.0.0.1:PORT/v1 answered 200 but sent no readable
                    stream — 1 line arrived, none of them an SSE \"data:\" frame
                    (Content-Type: text/html). This is not an empty answer from the model;
                    nothing usable arrived. Check that LLM_BASE_URL points at an
                    OpenAI-compatible /chat/completions that honours stream:true.",
                    "kind":"not-openai-compatible"}
```

Guard: `__tests__/api/chat-stream-silent-empty.test.ts` (7 tests). It uses **real HTTP servers,
not a fetch mock**, on purpose — the bug lives in how the body *streams*, and a mock that
resolves a string cannot exercise a reader loop.

---

## 3. THE SEAM PROOF — 10 wrong endpoints, 4 surfaces, before and after

Ten synthetic servers on `127.0.0.1:19601-19610`. `LLM_BASE_URL` is read at module load and the
shared dev server on :3000 cannot be restarted, so **each scenario ran in a freshly spawned child
process** importing the real TS modules through `scripts/lib/ts-import.mjs`. Real sockets, real
`fetch`, no mocks. **That is what I did; I did not restart the dev server.**

`probeProvider()` — the `/api/health` and runtimes-registry surface — BEFORE:

| Scenario | `kind` | Sentence |
|---|---|---|
| 200 HTML | *(no such field)* | `…does not answer — …answered 200 but the body is not JSON` |
| HTTP 401 | *(no such field)* | `…does not answer — …/models responded 401` |
| HTTP 500 | *(no such field)* | `…does not answer — …/models responded 500` |
| Ollama-native shape | *(no such field)* | `…does not answer — …has no top-level "data" array` |
| `{"data":[],"error":…}` | *(no such field)* | `…answers but serves no models… Pull one first` |

Every one of those endpoints **answered**. The first row is self-contradictory inside a single
sentence. The last row tells an operator to install a model when the gateway just said
*no permission for this org*.

AFTER — same ten servers, same harness:

| Scenario | `kind` | Sentence (lead clause) |
|---|---|---|
| 200 HTML | `not-openai-compatible` | `…answered, but it is not an OpenAI-compatible endpoint` |
| truncated JSON | `not-openai-compatible` | `…answered, but it is not an OpenAI-compatible endpoint` |
| Ollama-native shape | `not-openai-compatible` | `…answered, but it is not an OpenAI-compatible endpoint` |
| HTTP 401 | `error-status` | `…answered with an error status — …responded 401` |
| HTTP 500 | `error-status` | `…answered with an error status — …responded 500` |
| `{"data":[],"error":…}` | `error-status` | `…the endpoint is reporting a fault, not an empty model list: no permission for this org` |
| hang (timeout) | `unreachable` | `…does not answer` |
| body reset mid-read | `unreachable` | `…does not answer` |
| **empty roster** | `empty-roster` | `…answers but serves no models` ← **the only one** |
| real roster (2 models) | — | `ok: true` |

`{"object":"list","data":[]}` is now the **only** input in the whole matrix that produces
"serves no models". `llmStatus()` carries `kind` on every failure row; `probeOpenAiShape()`
no longer calls an HTTP 401 "a different API".

**The four required probes, explicitly:** plain HTTP server (19601, HTML 200) → *not
OpenAI-compatible*; a 500 (19602) → *error status*; a hang (19603, 2.5s timeout) → *unreachable*;
real Ollama on :11434 → *ok, 3 models*. Four distinct legible messages.

---

## 4. WHERE THE CRITIC WAS WRONG

I verified each claim rather than complying. Two are wrong and one is overstated.

**WRONG — "that false sentence is now PINNED by two assertions
(`openai-api-availability.test.ts:53` and `:129`), so fixing it now breaks a green test."**
It does not. Both assertions set up their scenario with `fetchMock.mockRejectedValue(new
Error('fetch failed'))` — a **genuinely unreachable** endpoint, the one case where "does not
answer" is true. My fix keeps that wording for `kind === 'unreachable'` and changes only the
other two kinds. **`__tests__/runtimes/openai-api-availability.test.ts` passes unedited.** I did
not touch it. The claimed obstacle to fixing the loudest speaker did not exist.

**WRONG — the brief's `bash scripts/smoke-test-layout.sh` baseline of "NINE guards".**
Measured today: **12 guards** plus the completion line (sidebar, mobile nav, layout wrapper,
header, no-invented-projects, no-dead-modules, no-phantom-columns, no-cloud-provider,
check-boolean-columns, check-no-secrets, honest-error, scope). The critic already flagged this;
confirming independently.

**OVERSTATED — fabrication #2**, that the `usage/route.ts:192-193` comment is false. The comment
claims the probe "names the URL and the exact reason rather than showing a fabricated
plan/balance". The *plan/balance* half is true and is the point the comment was written to make.
What is false is narrower and still worth fixing: the hardcoded lead word `unreachable`. Filed
precisely, in §5.

**CONFIRMED, and I re-derived it myself** rather than trusting the report: running the shipped
`reasonFrom()` on the shipped messages, a base URL missing its `/v1` renders on the Settings
usage card as, verbatim —

```
unreachable — http://127.0.0.1:19843 — set LLM_BASE_URL to http://127.0.0.1:19843/v1.
```

— the whole diagnosis discarded, under a word invented for an endpoint that answered 200.

**CONFIRMED:** mutant C6. Deleting `cache: 'no-store'` from `lib/llm-provider.ts:385` left all
seven seam suites green, because every assertion in the suite named `chat-model-list-is-live`
read `calls[0][0]` (the URL) and none read `calls[0][1]` (the init). Closed:
`expect((fetchMock.mock.calls[0][1] as RequestInit).cache).toBe('no-store')`.

**CONFIRMED:** the `{"data":[],"error":{…}}` hole, the ungated Ollama enrichment, and the
Ollama-only empty-roster advice. All three fixed.

---

## 5. SEAM REQUESTS — expressed as failing tests, not prose

`__tests__/api/llm-kind-seam-requests.test.ts` is **RED by design** and each failure prints its
own before/after diff. Four requests against three files this lane does not own:

1. `app/api/settings/usage/route.ts` — stop hardcoding `unreachable` for every kind
   (`localLlmProbe.value.kind` is already in scope and ignored).
2. `app/api/settings/usage/route.ts` — `reasonFrom()` uses `lastIndexOf(' — ')`; should be
   `indexOf`, so the diagnosis is not thrown away.
3. `app/api/business-agents/route.ts:45` — pass `kind: resolved.kind` through.
4. `app/api/onboarding/route.ts:40` — same.

They read source text deliberately: the point is that a *file* has not changed, and a
behavioural test cannot be written against a route this lane must not edit.

---

## 6. ACCEPTANCE — checkable without trusting me

Each of these is a command and an expected result.

1. `npx tsc --noEmit` → exit 0, no output.
2. `npx jest __tests__/api/chat-stream-silent-empty.test.ts` → **7/7**. Revert the `sawFrame`
   block in `app/api/chat/route.ts` and 3 of them go red with the literal received string
   `data: {"done":true}`.
3. `npx jest __tests__/api/llm-failure-kind-survives.test.ts` → **9/9**.
4. `npx jest __tests__/runtimes/provider-probe-shape-honesty.test.ts` → **11/11**.
5. `npx jest __tests__/runtimes/openai-api-availability.test.ts` → passes, **file unmodified by
   this lane** (`git diff HEAD -- __tests__/runtimes/openai-api-availability.test.ts` is empty).
   This is the check for §4's first claim.
6. `npx jest __tests__/api/llm-kind-seam-requests.test.ts` → **4 failures, by design**, each
   printing a diff. Green means the seam landed.
7. Delete `cache: 'no-store'` from `lib/llm-provider.ts` → `chat-model-list-is-live` goes red.
   (Before this round it stayed green — that was mutant C6.)
8. `node scripts/no-cloud-provider.mjs` → exit 0, "no ruled-out provider named in live code".
9. `bash scripts/smoke-test-layout.sh` → exit 0, 12 guards.
10. Live, with an owner cookie: `GET /api/chat/models` → 200, roster from real Ollama;
    `POST /api/chat` with `modelOverride:"anthropic/claude-sonnet-4-5"` → 400 naming the id;
    `POST /api/chat` normal → `data: {"delta":"P"}` / `data: {"delta":"ONG"}` / `data: {"done":true}`.

**Request-count check (competitor gap 6b):** point `fetchLiveModels(…, {includeContextLength:
true})` at a non-Ollama endpoint serving 60 models and count inbound requests.
Before: **62** (`GET /v1/models`, `GET /api/ps`, 60 × `POST /api/show`, every one authenticated,
every one a 404). After: **1**. Against real Ollama on :11434 the enrichment still runs —
measured, `trainedContextLength: 32768` on all three models — so the gate did not cost the
feature it was written for.

---

## 7. WHAT I DID NOT VERIFY, AND WHAT I GOT WRONG

- **A prediction of mine that the measurement REFUTED.** I expected
  `readModelsResponse()`'s `res.text().catch(() => '')` to misreport a mid-body connection reset
  as `not-openai-compatible` (a transport failure wearing a configuration-fault label). I built
  the case (server writes a `content-length: 400` header, then destroys the socket) and it came
  back `unreachable` — undici throws at the `fetch()` call before `res.text()` is ever reached.
  I could not construct an input that reaches that `catch`. **Unproven; left alone.**
- **Site 13 not fixed.** `fetchServedContextLengths` / `fetchTrainedContextLength` turn a non-2xx
  or a throw into "unknown", which is indistinguishable from "the model is not loaded". This IS
  the class. I left it because the documented contract on `LlmModel` already says absent means
  unknown and is never backfilled, so no consumer is being told something false — and because
  changing the shape ripples into files other lanes own. **A future round should carry a
  `contextLengthUnknownBecause` rather than widen this doc's claim.**
- **No browser, no DOM, no pixel.** Whether `ChatTab` renders the new error frame is a source
  trace only. I could not drive a wrong `LLM_BASE_URL` through the shared :3000 server.
- **One OS, one non-Ollama server type.** Windows 11 only. Every non-Ollama endpoint I tested was
  synthetic — no LM Studio, vLLM, llama.cpp or hosted gateway was available. "Runs on **any**
  machine" remains **UNPROVEN**; what is proven is that nothing in the seam is Ollama-specific
  any more, and that 12 deliberately-wrong endpoints are told apart correctly.
- **HTTPS/TLS and DNS failures unprobed.**
- **`__tests__/runtimes/spawn-live.test.ts` is still red** (known baseline). Worth repeating the
  critic's point: it is the one test that would exercise a real `openai-api` dispatch through the
  runtime, so **the adapter's spawn path still has no green live coverage.** My sweep covers the
  probe and the chat relay, not spawn.

---

## 8. GATES — run by me, today, on this machine

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0, zero output** |
| Lane suites (9 files) | **87 passed / 87** |
| `node scripts/acceptance/run.mjs` | first run 44/45 @ 8703 ms → **re-ran: 45/45, 10/10, 3530 ms** (load, exactly as the brief predicts) |
| `bash scripts/smoke-test-layout.sh` | **exit 0, 12 guards** |
| `node scripts/no-cloud-provider.mjs` | **exit 0**, 269 files scanned |
| `npx jest` (full) | 15 suites failed / 103 passed. **None of the failures is a regression from this lane.** |

Breakdown of the full-run failures, because "15 failed" needs an account:
- **4 are mine and intentional** — `llm-kind-seam-requests.test.ts`, the RED seam requests (§5).
- **6 are other lanes' RED-by-design seam requests** — `inbox-db-proxy-seam`,
  `login-surface-seam`, `middleware-role-source-seam`, `fleet-provenance-seams`,
  `pieces9-seams`, `agent-budget-sweep-seam`.
- **1 is the known baseline** — `spawn-live`.
- **5 are environmental, not assertions** — `agent-kv`, `conversations`, `db-seam`,
  `issue-moves`, `migrations-from-zero` fail with
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` out of PGlite under Node 24, or as
  `Jest worker encountered 4 child process exceptions` under concurrent load from other lanes.
  None touches a file this lane owns.

Fixtures: **none created.** Every measurement used synthetic HTTP servers in the session
scratchpad or read-only live GETs. No row was written to any table, `Limiglow` or otherwise.
All probe ports (19601-19610, 19621-19625, 19731) are closed.
