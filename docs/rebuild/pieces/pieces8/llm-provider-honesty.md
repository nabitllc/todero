# pieces8 / llm-provider-honesty

**Channels:** LLM Provider Independence 8/9 · Observability & Honest Reporting 8/9
**Benchmark:** "Runs on any machine against any OpenAI-compatible LLM API, tested with local Ollama."
**Owned files:** `lib/llm-provider.ts`, `app/api/chat/**`, `__tests__/api/llm-endpoint-shape-honesty.test.ts`, this doc.
**Date of every measurement below:** 2026-08-26. Nothing in this file is copied from an earlier session.

---

## 1. The defect, measured

Another agent reported it and left it out of scope. I reproduced it before touching anything.

`lib/llm-provider.ts`'s `fetchLiveModels()` read the body as

```ts
const body = await res.json().catch(() => null)
const models: LlmModel[] = Array.isArray(body?.data) ? body.data : []
```

(the `res.json().catch(() => null)` line is at `lib/llm-provider.ts:229` in `git show HEAD:lib/llm-provider.ts`).

A `.catch(() => null)` on the parse plus a `: []` on the shape means **any HTTP 200 whatsoever
becomes `{ ok: true, models: [] }`** — the same value a healthy, OpenAI-compatible endpoint with
nothing pulled returns.

### How I measured it

Harness (scratch, not committed):
`…/scratchpad/llm/probe.mjs` + `probe-child.mjs`. It stands up seven deliberately-wrong HTTP
servers on 127.0.0.1:19801-19807, then for each one **spawns a fresh child process** that imports
`lib/llm-provider.ts` through `scripts/lib/ts-import.mjs` with `LLM_BASE_URL` set to that server,
and prints the raw return value of `fetchLiveModels()`.

A fresh child per case is required, not stylistic: **`LLM_BASE_URL` is read at module load**
(`lib/llm-provider.ts:14`), and the shared dev server on :3000 must stay running, so it cannot be
restarted per scenario. The seam is therefore exercised directly, in-process, out-of-band from the
dev server. **This is module-level evidence, not browser evidence.**

### BEFORE — raw output

```
### plain HTML page (200 text/html)            {"ok":true,"models":[]}
### HTTP 500                                   {"ok":false,"error":"…/models responded 500: Internal Server Error"}
### hangs, never responds                      {"ok":false,"error":"… is unreachable — The operation was aborted due to timeout"}   (2005 ms)
### valid JSON, native-Ollama shape (no /v1)   {"ok":true,"models":[]}
### real OpenAI shape, genuinely zero models   {"ok":true,"models":[]}
### real OpenAI shape, one model               {"ok":true,"models":[{"id":"qwen2.5-coder:7b"}]}
### proxy login screen (200 HTML)              {"ok":true,"models":[]}
### nothing listening (connection refused)     {"ok":false,"error":"… is unreachable — fetch failed"}
```

**Four different causes, one identical answer.** Three of those four are configuration faults where
"pull a model" fixes nothing:

| cause | what the operator actually has to do | what the product said |
|---|---|---|
| plain HTML index page | fix `LLM_BASE_URL` | "returned no models — pull one first" |
| proxy login screen in front of the endpoint | authenticate / fix the URL | "returned no models — pull one first" |
| `LLM_BASE_URL` missing its `/v1` suffix | add `/v1` | "returned no models — pull one first" |
| real endpoint, nothing pulled | `ollama pull …` | "returned no models — pull one first" |

`scripts/lib/env-report.mjs`'s `probeOpenAiShape()` (lines 97-130) already drew this distinction —
but only at **diagnosis** time, inside `npm run doctor` / `npm run setup`. The **product** path had
no idea. The one an operator would actually act on was the invisible one.

---

## 2. What I changed

### `lib/llm-provider.ts`

1. **New exported type `LiveModelsFailureKind`** — `'unreachable' | 'error-status' | 'not-openai-compatible'`.
   `LiveModelsResult`'s failure variant gained `kind?: LiveModelsFailureKind`.
   `kind` was **optional**, because `lib/runtimes/openai-api.ts:115-136` constructed this same type
   and was outside this lane's ownership; every failure produced by `lib/llm-provider.ts` itself
   always set it.
   > **CORRECTED, round 2 (2026-08-26).** No longer true of the shipped code. That escape hatch is
   > exactly how the defect survived one file over. `kind` is now **required**, the second parser is
   > deleted, and both callers share `readModelsResponse()`. See §10.1.

2. **`fetchLiveModels()` now checks the shape before believing the body.** It reads
   `res.text()`, `JSON.parse`s it explicitly, and returns `kind: 'not-openai-compatible'` for:
   - a body that is not JSON (message carries the status, the `Content-Type`, and a 120-char
     whitespace-collapsed snippet of the body);
   - JSON with no top-level `data` array (message lists the top-level keys and says
     *"If this is Ollama, LLM_BASE_URL needs its /v1 suffix"* — the measured, dominant real cause);
     > **CORRECTED, round 2.** That sentence is now *"If this is Ollama, the base URL needs its /v1
     > suffix — set LLM_BASE_URL to `<url>/v1`"*, and it is **conditional**: suppressed when the
     > configured URL already ends in `/v1`, because naming a missing suffix on a URL that has one
     > is a confident wrong answer. It was also unguarded — see §10.2.
   - a `data` array of N entries none of which carries a string `id`.

   The success path filters `data` to entries with a non-empty string `id`.

3. **`noModelsError()` exported** — the single sentence for "compatible endpoint, empty roster",
   so the three chat routes cannot drift into three phrasings. Its text now says the endpoint *is*
   OpenAI-compatible, which it could not honestly say before.

4. **`resolveConfiguredModel()`** propagates `kind` on its 502. It deliberately sets **no** `kind`
   for the empty-roster refusal, because that is not a fetch failure — `fetchLiveModels` returned
   `ok: true` — it is the function's own refusal to invent a model id.

### `app/api/chat/models/route.ts`
502 bodies now carry `kind` next to `error` (`"not-openai-compatible"` / `"unreachable"` /
`"error-status"` / `"empty-roster"`) so a client can branch without parsing prose. The
"pull one first" branch now uses `noModelsError()` and is reachable only from a genuinely
compatible endpoint.

### `app/api/chat/route.ts`
`sseError()` takes an optional `kind` and emits it in the SSE frame alongside `error` (additive —
`ChatTab` reads `error` and is untouched, and is not my file). Both roster failure branches pass it.

### `app/api/chat/autotitle/route.ts`
Same: 502 body carries `kind`; empty-roster uses `noModelsError()`.

### `__tests__/api/llm-endpoint-shape-honesty.test.ts` (new, 16 tests)
Uses **real `Response` objects**, not hand-rolled stand-ins, so the tests cannot pass on a stub the
runtime object would fail. Covers each wrong shape, the two non-shape failure kinds, the
`resolveConfiguredModel` passthrough, and the route layer. The load-bearing one:

```
it('the four causes that used to be identical are now four different answers')
  → expect(new Set(answers).size).toBe(4)
  → expect(answers.filter(a => a === '{"ok":true,"models":[]}')).toHaveLength(1)
```

Before the fix that set had size **1**.

---

## 3. AFTER — same harness, same seven servers, re-run

```
### plain HTML page (200 text/html)
  {"ok":false,"kind":"not-openai-compatible","error":"http://127.0.0.1:19801/v1/models answered 200
   but the body is not JSON (Content-Type: text/html) — this is not an OpenAI-compatible endpoint.
   LLM_BASE_URL must point at a server that serves GET /models as {\"data\":[{\"id\":…}]}.
   Body starts: <!doctype html><html><body><h1>It works!</h1></body></html>"}

### HTTP 500
  {"ok":false,"kind":"error-status","error":"http://127.0.0.1:19802/v1/models responded 500: Internal Server Error"}

### hangs, never responds                      (2019 ms — the 2s timeout, not a hang)
  {"ok":false,"kind":"unreachable","error":"http://127.0.0.1:19803/v1 is unreachable — The operation was aborted due to timeout"}

### valid JSON, native-Ollama shape (no /v1)
  {"ok":false,"kind":"not-openai-compatible","error":"http://127.0.0.1:19804/models answered 200 with
   JSON that has no top-level \"data\" array — the OpenAI /models shape is {\"data\":[{\"id\":…}]}, so
   this endpoint speaks a different API. Top-level keys: models. If this is Ollama, LLM_BASE_URL
   needs its /v1 suffix."}

### real OpenAI shape, genuinely zero models
  {"ok":true,"models":[]}                       ← the ONLY remaining empty list

### real OpenAI shape, one model
  {"ok":true,"models":[{"id":"qwen2.5-coder:7b"}]}

### proxy login screen (200 HTML)
  {"ok":false,"kind":"not-openai-compatible","error":"…Body starts: <html><body><form>Sign in to continue</form></body></html>"}

### nothing listening (connection refused)
  {"ok":false,"kind":"unreachable","error":"http://127.0.0.1:19899/v1 is unreachable — fetch failed"}
```

Eight scenarios, eight legible answers. **None of them is a 500 at first use**, and none of them is
a silent empty menu.

---

## 4. Real HTTP against the running dev server (:3000)

Session cookie obtained via `POST /api/auth`. The server's own `LLM_BASE_URL` is
`http://localhost:11434/v1` and cannot be changed without restarting it, so these prove the happy
path and the model-resolution refusal survived the edit — **not** the wrong-endpoint cases, which
are proven at module and route level above.

```
GET /api/chat/models
  HTTP 200
  {"base_url":"http://localhost:11434/v1","default_model":"qwen2.5-coder:7b",
   "models":[{"id":"qwen2.5-coder:14b","trainedContextLength":32768},
             {"id":"qwen2.5-coder:32b","trainedContextLength":32768},
             {"id":"qwen2.5-coder:7b","trainedContextLength":32768}]}

POST /api/chat  {"messages":[…],"modelOverride":"anthropic/claude-sonnet-4-5"}
  HTTP 400
  {"error":"unknown model \"anthropic/claude-sonnet-4-5\" — not present in http://localhost:11434/v1/models",
   "id":"anthropic/claude-sonnet-4-5"}

POST /api/chat  {}
  HTTP 200, SSE:  data: {"error":"messages array is required"}
```

Direct check that Ollama really is what is answering:
`curl http://localhost:11434/v1/models` → HTTP 200, three models (`qwen2.5-coder:7b/14b/32b`).

---

## 5. ACCEPTANCE — checkable without trusting this document

A fresh critic can run each of these and read the result themselves.

1. **The silent default is gone from the product path.**
   `grep -n "Array.isArray(body?.data) ? body.data : \[\]" lib/llm-provider.ts` → **no match**.
   (It still matches `lib/runtimes/openai-api.ts:136` — see §7, not my file.)
   > **CORRECTED, round 2.** That second hit is gone too: the grep now returns **zero hits
   > repo-wide** in `.ts`/`.tsx` outside a comment. Measured §10.1.

2. **The new guard fails against the old code.** Check out `HEAD`'s `lib/llm-provider.ts` into a
   scratch copy and run the new suite against it; `the four causes that used to be identical`
   asserts `new Set(answers).size === 4` and the old code yields `1`.
   Cheaper equivalent: read the BEFORE block in §1 — it is the old module's own stdout.

3. **`npx jest __tests__/api/llm-endpoint-shape-honesty.test.ts`** → **16 passed, 16 total.**

4. **Distinctness at the seam.** Re-run the harness in §1 (recreate `probe.mjs` from the description
   or point `LLM_BASE_URL` at any HTML-serving port). A plain-HTML 200 must produce
   `kind: 'not-openai-compatible'`; `{"object":"list","data":[]}` must produce
   `{ ok: true, models: [] }`. If those two ever match again, the fix is gone.

5. **Route layer.** `GET /api/chat/models` with an HTML-200 endpoint answers **HTTP 502** with
   `kind: "not-openai-compatible"` and an `error` that does **not** contain `pull one first`;
   with `{"data":[]}` it answers 502 with `kind: "empty-roster"` and an `error` that **does**.
   Both asserted in the test file's last describe block.

6. **No cloud provider was added.** `node scripts/no-cloud-provider.mjs` → passes (it also runs
   inside the smoke test, which is green). The diff adds no new endpoint, no vendor name, no second
   base URL. `git diff` touches four files, all under this lane's ownership.

7. **The happy path is unchanged.** `GET /api/chat/models` against the live server still returns the
   three real Ollama ids with `trainedContextLength` present and `servedContextLength` absent
   (nothing loaded) — unknown still renders as unknown, never backfilled.

8. **Gates.** ~~`npm test` failure set = `spawn-live` only (1344 passed / 1347, 2 skipped)~~;
   `node scripts/acceptance/run.mjs` 45/45, 10/10; `bash scripts/smoke-test-layout.sh` exit 0.
   ~~`npx tsc --noEmit` … reported 4 errors, all in `components/nav/RunsView.tsx`.~~
   > **CORRECTED, round 2 — these numbers are stale and no longer true.** `npx tsc --noEmit` now
   > exits **0 with no output**; the RunsView errors were another lane's in-flight file and that
   > lane finished. The jest totals moved as other lanes landed tests, and the failure set is
   > larger and entirely elsewhere. The measured, dated numbers are in **§10.5** — read those, not
   > these. The line that is still true: nothing in the failure set names `llm-provider`,
   > `api/chat`, `llm-endpoint-shape`, or `provider-probe`.

---

## 6. SEAM DIFF requested from the orchestrator

**None.** No change is needed in `app/page.tsx` or `components/nav/config.ts`. This piece is
complete as written.

---

## 7. Reported, NOT fixed — outside this lane's ownership

**`lib/runtimes/openai-api.ts:136` carries the identical defect.**

```ts
const body = await res.json().catch(() => null)
return { ok: true, models: Array.isArray(body?.data) ? body.data : [] }
```

That is `fetchModelsFrom()`, the branch taken when `resolveProvider()`'s base URL **differs** from
`LLM_BASE_URL` (i.e. `OPENAI_BASE_URL` is set to something else). It feeds `probeProvider()` and
`listRuntimes()`, so the runtimes registry and `/api/health` can still report a plain HTML page as a
reachable provider with zero models. The fix is the same shape as mine and `LiveModelsFailureKind`
is exported and ready for it. **I did not touch that file.**

> **SUPERSEDED, round 2 (2026-08-26).** The orchestrator named this the single biggest gap and
> directed the fix. It is fixed, with the smallest possible footprint in the foreign file: the
> parser moved into `lib/llm-provider.ts` as the exported `readModelsResponse()` /
> `unreachableModelsResult()`, and `fetchModelsFrom()` now calls them. Measured before-and-after
> over real sockets in **§10.1**. The rest of §7's diagnosis was correct in every particular.

**Transient, another lane, already resolved:** at ~17:45 the dev server returned HTTP 500 on every
route with `ModuleBuildError: the name 'projectMap' is defined multiple times` at
`app/api/inbox/route.ts:531/598`. That was an in-flight edit in another lane, not my change and not
a defect I introduced; by the next check the duplicate was gone and `/api/chat/models` was back to
HTTP 200. Recorded here only so nobody re-attributes it.

---

## 8. What I did NOT verify — explicitly

- **No DOM-level or browser evidence of anything.** I have no browser tool. I did not look at the
  Chat tab, its model dropdown, or how `ChatTab` renders any of these new messages. The `kind` field
  I added to the SSE frame and to the 502 bodies is **additive and unread by any client today** —
  I did not modify `components/ChatTab.tsx` (not my file) and cannot claim the user sees a better
  screen, only a better message string. The orchestrator's wave-boundary browser pass is the place
  that gets confirmed.
  > **CORRECTED, round 2, twice over.**
  > (a) **The path is wrong.** There is no `components/ChatTab.tsx`. The component is at
  >     `components/tabs/ChatTab.tsx` (`ls` confirms one exists and the other does not). The
  >     substance — "I did not modify it" — is true.
  > (b) **"only a better message string" understates it, in the user's favour.** Traced in source
  >     this round: `components/tabs/ChatTab.tsx:481` and `components/OnboardingWizard.tsx:145`
  >     both put the 502 body's `error` into `ApiError.message` via `lib/fetch-json.ts:60-62`, and
  >     it is rendered verbatim in a red banner at `ChatTab.tsx:1830` and `:2610`
  >     (`⚠️ {modelsError.message}`, with the comment "rendered verbatim … the operator needs to
  >     see WHICH endpoint is down"). The new prose therefore **does** reach the screen. This is a
  >     source trace, not a DOM observation — I still have no browser (§10.6).
- **The wrong-endpoint cases were never exercised through the running dev server on :3000.**
  `LLM_BASE_URL` is read at module load and the shared server must not be restarted, so those are
  proven by (a) direct module import in a fresh child process and (b) jest against the route
  handler. I did not, and could not, `curl` localhost:3000 with a broken `LLM_BASE_URL`.
- **No real non-Ollama OpenAI-compatible server was tested.** "Any OpenAI-compatible API" is
  supported by *shape*, verified against synthetic servers I wrote; the only real server exercised
  is the local Ollama. LM Studio, vLLM, llama.cpp, and hosted APIs were not tried.
- **No end-to-end chat completion was run.** I never streamed a real assistant reply, so the
  `/chat/completions` path, the SSE transform, and the `chat_messages` persistence are untouched by
  my testing (and untouched by my diff apart from `sseError`'s extra optional argument).
- **HTTPS/TLS failures, DNS failures, and redirect-to-login (3xx) endpoints** were not probed. A
  302 to a login page lands in `error-status`, which is plausible but I did not measure it.
  > **CORRECTED, round 2 — the guess was wrong, and the real behaviour is better than the guess.**
  > Measured today over real sockets: Node's `fetch` follows the redirect by default, so `res.status`
  > is the **200** of the login page, not the 302. It lands in
  > `kind: 'not-openai-compatible'` with *"the body is not JSON (Content-Type: text/html) … Body
  > starts: `<html><body><form>Sign in to continue</form></body></html>`"*. Raw output in §10.3.
  > HTTPS/TLS and DNS failures are still unprobed; both go through the same `catch` as any other
  > `fetch` rejection and would report `unreachable`, which I have **not** measured.
- **I did not re-verify `scripts/lib/env-report.mjs`'s `probeOpenAiShape()` still agrees** with the
  new product-path verdicts, or run `npm run doctor`. That file is not mine and I did not change it;
  the two now duplicate the same judgement, which is worth collapsing later.
- **`npm run build` was never run** (forbidden by the lane rules). Type safety rests on
  `npx tsc --noEmit`.

## 9. Fixtures

**None created.** This lane needed no database rows: every test is fetch-mocked or points at a
local HTTP server in the scratchpad. No `Limiglow` row was written, read-modified, or deleted, and
`TOD-1` was not touched. `POST /api/auth` sets cookies only and writes no row (verified: no
`insert`/`from(` in `app/api/auth/route.ts`). The two `POST /api/chat` probes carried no
`conversationId`, and the route only writes when one is present.

---

# 10. ROUND 2 — 2026-08-26, second session

Everything in §1-§9 is the first session's record and is left standing, with correction blocks
inserted where a line asserted something untrue of the shipped code. This section is what was
**measured, changed, and left open in this round**. Every number below was produced by a command
run in this session; nothing is carried over.

A fresh-context critic scored the piece 8/10, named one large gap, and found four inaccuracies.
**Each was re-measured here before being acted on.** The verdict on the critic: **five of five
correct, one of them understated.** Details per claim in §10.7.

---

## 10.1 THE GAP — the identical defect, still live one file over. FIXED.

### Verified first, as a claim, not a fact

```
$ grep -rn 'Array.isArray(body?.data) ? body.data : \[\]' --include=*.ts --include=*.tsx .
lib/runtimes/openai-api.ts:136:  return { ok: true, models: Array.isArray(body?.data) ? body.data : [] }
__tests__/api/llm-endpoint-shape-honesty.test.ts:8:  (…inside a comment describing the defect)
```

Exactly one live hit, at exactly the line the critic named. That is `fetchModelsFrom()`, the branch
`probeProvider()` takes when `resolveProvider()`'s base URL differs from the module-level
`LLM_BASE_URL`. It feeds `openaiApiRuntime.isAvailable()`, `listRuntimes()` and **`/api/health`** —
the observability surface this piece's second channel is scored on.

### Measured BEFORE and AFTER over real sockets

Not fetch-mocked. Six one-file HTTP servers on `127.0.0.1:19841-19846`, and for each case a **fresh
child process** that imports `lib/runtimes/openai-api.ts` via `scripts/lib/ts-import.mjs` with
`LLM_BASE_URL` set to a dead URL at import time, then points `process.env.LLM_BASE_URL` at the test
server before calling `probeProvider()` — which is what forces the direct-probe branch, since
`resolveProvider()` reads the env at call time while the module constant was fixed at import.
Harness: `…/scratchpad/llm2/servers.mjs` + `probe-child.mjs` (scratch, not committed). Servers were
shut down afterwards; `netstat` confirms no listener remains on any of those ports.

**BEFORE** (the shipped `openai-api.ts` of round 1, restored for the measurement and then reverted —
`md5sum` back to `cf0e963f176d5fb52742c58f2aaeb488`):

```
### plain HTML 200          {"ok":false,"reason":"http://127.0.0.1:19841/v1 answers but serves no models — dispatch through it will fail. Pull one first (e.g. `ollama pull qwen2.5-coder:7b`)."}
### proxy login screen 200  {"ok":false,"reason":"http://127.0.0.1:19842/v1 answers but serves no models — dispatch through it will fail. Pull one first (e.g. `ollama pull qwen2.5-coder:7b`)."}
### Ollama-native, no /v1   {"ok":false,"reason":"http://127.0.0.1:19843 answers but serves no models — dispatch through it will fail. Pull one first (e.g. `ollama pull qwen2.5-coder:7b`)."}
### OpenAI shape, 0 models  {"ok":false,"reason":"http://127.0.0.1:19844/v1 answers but serves no models — dispatch through it will fail. Pull one first (e.g. `ollama pull qwen2.5-coder:7b`)."}
```

**Four unrelated causes, one byte-identical sentence — on `/api/health`.** The exact defect §1
measured at the seam, still being published by the registry after §2 "fixed" it. The critic was
right, and this is the strongest single piece of evidence in the whole piece.

**AFTER** (shipped code, same servers, same harness, same session):

```
### plain HTML 200          not-OpenAI-compatible: "…answered 200 but the body is not JSON (Content-Type: text/html) — this is not an OpenAI-compatible endpoint. … Body starts: <!doctype html><html><body><h1>It works!</h1></body></html>"
### proxy login screen 200  same kind, "…Body starts: <html><body><form>Sign in to continue</form></body></html>"
### Ollama-native, no /v1   "…JSON that has no top-level \"data\" array … Top-level keys: models. If this is Ollama, the base URL needs its /v1 suffix — set LLM_BASE_URL to http://127.0.0.1:19843/v1."
### OpenAI shape, 0 models  "http://127.0.0.1:19844/v1 answers but serves no models — dispatch through it will fail. Pull one first (e.g. `ollama pull qwen2.5-coder:7b`)."   ← the ONLY one that still says this
### OpenAI shape, 1 model   {"ok":true}
### HTTP 500                "…/v1/models responded 500: Internal Server Error"
### nothing listening       "…/v1 is unreachable — fetch failed"
```

Seven scenarios, seven legible answers, and "pull one first" is now reachable from exactly one of
them.

### How it was fixed — and the ownership problem, stated plainly

**`lib/runtimes/openai-api.ts` IS NOT IN THIS LANE'S OWNERSHIP LIST.** The orchestrator's brief
named the file and the line and directed the fix; that instruction is the only authority for the
edit, and it is recorded here so the orchestrator can revert it in one step if another lane owns
that file. **Everything else this round is inside the lane.**

The footprint in the foreign file was kept as small as the fix allows. Rather than copy 40 lines
into it, the parser moved *out* into the file this lane does own:

- `lib/llm-provider.ts` now exports **`readModelsResponse(baseUrl, res)`** and
  **`unreachableModelsResult(baseUrl, err)`**. `baseUrl` is a parameter, not the module constant,
  precisely because `openai-api.ts` may dial a different URL — and reporting the module constant for
  a URL that was never contacted is its own lie.
- `fetchLiveModels()` calls both. Its outputs are **unchanged** for every case in §3 except the
  `/v1` hint wording (§10.2).
- `openai-api.ts`'s `fetchModelsFrom()` lost its 20-line hand-rolled parser and now calls the same
  two functions. Net: **−20 lines of logic, +6 lines**, plus a tombstone comment quoting the old
  code and saying why one parser is the point.
- **`LiveModelsResult.kind` is now REQUIRED, not optional.** That is the part that makes it stick:
  the comment that used to say "optional only because another file constructs this" was itself the
  loophole the defect lived in. A third hand-rolled copy will not type-check. `npx tsc --noEmit`
  exits 0 with the field required, so **no other lane's file was relying on the optionality.**

### Guarded by a test that fails against the old code

New: **`__tests__/runtimes/provider-probe-shape-honesty.test.ts`** — 10 tests, at the registry layer
(`openaiApiRuntime.isAvailable()` / `unavailableReason()`), including the piece's headline assertion
restated where `/api/health` reads it:

```
expect(new Set(answers).size).toBe(4)
expect(answers.filter(a => a.includes('serves no models'))).toHaveLength(1)
```

**Mutant M11** (revert `fetchModelsFrom` to the hand-rolled parser, `as LiveModelsResult` casts to
get past the now-required `kind`): **6 tests failed** in the new file. The pre-existing
`__tests__/runtimes/openai-api-availability.test.ts` stayed **fully green** under M11 — which is
the direct proof of the critic's point that this path had no coverage at all.

---

## 10.2 Mutation testing: the four survivors are dead

The critic ran 10 mutants and 4 survived. All four are re-run here against the current code. Each
was applied by script, run, and reverted; `md5sum` after each revert matches the pre-mutation value
(`lib/llm-provider.ts` `2cc0410fe5900576414009a4d2e92004`, `lib/runtimes/openai-api.ts`
`cf0e963f176d5fb52742c58f2aaeb488`, `app/api/chat/route.ts` `cd6cd477a843fab3e06cf738e8879ec6`,
`app/api/chat/autotitle/route.ts` `73485f6bf92d7f01f92640bfa7f87ef1`).

| mutant | round 1 | round 2 | what now catches it |
|---|---|---|---|
| **M1** delete the "needs its /v1 suffix" sentence | SURVIVED 16/16 green | **KILLED — 2 failed** | assertion is on the *sentence* and on the suggested URL, against a base URL that genuinely lacks `/v1`; plus the registry test |
| **M6** `sseError()` stops emitting `kind` | SURVIVED 16/16 green | **KILLED — 3 failed** | `chat-route-failure-kinds.test.ts` reads the actual SSE frame |
| **M7** `autotitle/route.ts` reverted wholesale | SURVIVED 16/16 green | **KILLED — 4 failed** | same file: kind + the "no pull one first" rule per failure kind |
| **M8** `noModelsError()` drops "the endpoint is OpenAI-compatible" | SURVIVED 16/16 green | **KILLED — 1 failed** | the doc's own §2.3 claim is now an assertion |
| **M11** (new) `openai-api.ts` back to the old parser | n/a | **KILLED — 6 failed** | §10.1 |

M1 deserves a note, because the critic diagnosed it exactly right: the old assertion was
`expect(live.error).toContain('/v1')`, and `LLM_BASE_URL` is literally `http://localhost:11434/v1`,
so deleting the whole hint sentence still passed on the URL echoed at the front of the message. An
assertion satisfied by its own preamble is not a guard.

Fixing it surfaced a **second, smaller dishonesty in the hint itself**: it said "LLM_BASE_URL needs
its /v1 suffix" unconditionally, including when the configured URL already ended in `/v1` — a
confident wrong answer of exactly the kind this piece exists to remove. The hint is now suppressed
when the suffix is present, and both directions are asserted:

```
it('names the missing suffix, and the exact URL to set, when there is no /v1')
it('does NOT blame a missing /v1 on a URL that already has one')
```

### Coverage added

| file | round 1 coverage | now |
|---|---|---|
| `lib/llm-provider.ts` | 16 tests | 22 (`llm-endpoint-shape-honesty.test.ts`, +6) |
| `app/api/chat/models/route.ts` | 4 tests | 4 (unchanged) |
| `app/api/chat/route.ts` | **none** | 5 (`chat-route-failure-kinds.test.ts`) |
| `app/api/chat/autotitle/route.ts` | **none** | 4 (same file) |
| `lib/runtimes/openai-api.ts` (probe path) | none for the shape | 10 (`provider-probe-shape-honesty.test.ts`) |

---

## 10.3 The §8 302 guess: measured, and wrong

Two servers on `127.0.0.1:19831` (302 → `19832/login`) and `19832` (200 `text/html` login screen);
`fetchLiveModels()` called from a fresh child with `LLM_BASE_URL=http://127.0.0.1:19831/v1`. Raw
output:

```json
{"ok":false,"kind":"not-openai-compatible",
 "error":"http://127.0.0.1:19831/v1/models answered 200 but the body is not JSON (Content-Type: text/html) — this is not an OpenAI-compatible endpoint. LLM_BASE_URL must point at a server that serves GET /models as {\"data\":[{\"id\":…}]}. Body starts: <html><body><form>Sign in to continue</form></body></html>"}
```

Node's `fetch` follows the redirect, so the status the seam sees is the login page's **200**, not the
302. It lands in `not-openai-compatible` — the more useful verdict, and better than §8's guess of
`error-status`. §8 hedged it as unmeasured, so this was an inaccuracy rather than a false success
claim; it is corrected in place. **HTTPS/TLS and DNS failures remain unmeasured** — they take the
same `catch` as any `fetch` rejection and would report `unreachable`, but I did not probe them and
do not claim it.

---

## 10.4 STILL OPEN — `kind` has no consumer. Verified, not fixed. Diffs requested.

The critic's third finding, re-checked this round and **confirmed**: the machine-readable field this
piece added is **write-only today**. Nothing reads it.

```
app/api/business-agents/route.ts:45   { error: resolved.error, id: resolved.id }     ← drops resolved.kind
app/api/onboarding/route.ts:40        { error: resolved.error, id: resolved.id }     ← drops resolved.kind
```

and no component branches on it. This is not a false claim in the doc — §8 already said the field is
"additive and unread by any client today" — but the headline value is unrealised until someone reads
it. **Neither file is in this lane's ownership**, so here are the exact diffs, as requested rather
than applied:

```diff
--- a/app/api/business-agents/route.ts
@@ -45
-    return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: resolved.status })
+    return NextResponse.json({ error: resolved.error, id: resolved.id, kind: resolved.kind }, { status: resolved.status })

--- a/app/api/onboarding/route.ts
@@ -40
-      return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: resolved.status })
+      return NextResponse.json({ error: resolved.error, id: resolved.id, kind: resolved.kind }, { status: resolved.status })
```

`resolved.kind` is already typed on `resolveConfiguredModel`'s failure variant, so both are
one-word additions that type-check as-is.

### Two more, found this round, also outside this lane

1. **`app/api/settings/usage/route.ts:44` `reasonFrom()`** recovers the failure mode by
   **string-matching the prose** (`error.lastIndexOf(' — ')`, `error.startsWith(url + '/models ')`).
   That is precisely the parsing `kind` exists to replace, and it will silently mis-slice the new
   `not-openai-compatible` message, whose body snippet can itself contain an em-dash. It is a
   cosmetic mis-slice, not a wrong verdict — but it is the best available first consumer of `kind`.
2. **`lib/resolve-dispatch-model.ts:140`** carries a **fourth, independent copy** of the
   "returned no models — pull one first" sentence, hand-written rather than `noModelsError()`, and
   therefore **missing the "the endpoint is OpenAI-compatible" clause** that makes the advice
   honest. §2.3 claimed the shared helper stops the wording drifting into several phrasings; that is
   true of the three *chat* routes it named, and false of the repo as a whole. Suggested:
   `import { noModelsError }` and replace the literal.

### One prose wart in the file I was directed into, deliberately not changed

`probeProvider()` wraps every failure as `"<url> does not answer — dispatch through it will fail:
<detail>"`. For the new shape verdicts that reads *"does not answer … answered 200 but the body is
not JSON"* — internally contradictory. The honest wording is `"<url> is not usable for dispatch:"`.
I did **not** change it: `__tests__/runtimes/openai-api-availability.test.ts` asserts the current
string in three places and that test file is outside this lane. Requested, not done.

---

## 10.5 GATES — every number below was run in this session, 2026-08-26

```
npx tsc --noEmit                    exit 0, ZERO output.  (Run twice: once as a baseline before
                                    any edit, once after the full change set, including with
                                    LiveModelsResult.kind required.)

npx jest  (full run, FIRST)         Test Suites:  6 failed, 1 skipped, 79 passed, 85 of 86 total
                                    Tests:        1 failed, 2 skipped, 1419 passed, 1422 total
npx jest  (full run, FINAL, ~40min  Test Suites: 10 failed, 1 skipped, 78 passed, 88 of 89 total
          later, same session)      Tests:       10 failed, 2 skipped, 1472 passed, 1484 total

node scripts/acceptance/run.mjs     45/45 passing (2606 ms), harness score 10/10

bash scripts/smoke-test-layout.sh   exit 0, 12 green checks + "Smoke test complete":
                                    sidebar · mobile-nav lg:hidden · layout wrapper · header ·
                                    no-invented-projects · no-dead-modules · no-phantom-columns ·
                                    no-cloud-provider · check-boolean-columns · check-no-secrets ·
                                    honest-error guard · scope guard (10 live probes)

node scripts/no-cloud-provider.mjs  exit 0, 264 files scanned, no ruled-out provider named
```

### The jest failure set, attributed

**Judge by the failure set, not the total** — the total moved by +3 suites and +62 tests inside this
one session as other lanes landed work, which is also why two full runs are recorded above rather
than one. **Not this lane: none of the ten names `llm-provider`, `api/chat`, `llm-endpoint-shape`,
or `provider-probe`.** The final run's set:

| suite | failure | whose |
|---|---|---|
| `__tests__/runtimes/spawn-live.test.ts` | 1 test — the known live-spawn failure | known baseline |
| `lib/__tests__/db-seam.test.ts` | suite failed to RUN | database lane |
| `lib/__tests__/migrations-from-zero.test.ts` | suite failed to RUN | database lane |
| `lib/__tests__/conversations.test.ts` | suite failed to RUN | database lane |
| `lib/__tests__/agent-kv.test.ts` | suite failed to RUN | database lane |
| `__tests__/api/commerce-partial-fulfilment.test.ts` | suite failed to RUN | commerce lane |
| `components/tabs/__tests__/inbox-actor-attribution.test.ts` | appeared between the two runs | inbox lane |
| `__tests__/office-waiting-on-you.test.ts` | appeared between the two runs | office lane |
| `__tests__/office-board-task-mirror.test.ts` | appeared between the two runs | office lane |
| `__tests__/office-board-task-polling.test.ts` | appeared between the two runs | office lane |

The four that appeared mid-session are another lane's in-flight edit, checked rather than assumed —
`office-board-task-polling` fails on
`Expected substring: "/api/issues?status=in_progress" / Received: "\"use client\";…"` from
`components/office/OfficeCanvas.tsx`, a file this lane has never opened.

The five "failed to run" report `Jest worker encountered 4 child process exceptions`. Run in
isolation the real cause appears, and it is a **runner/environment** problem, not a code defect and
not mine:

```
$ npx jest lib/__tests__/db-seam.test.ts --runInBand
TypeError: A dynamic import callback was invoked without --experimental-vm-modules
    at Object.N_ (node_modules/@electric-sql/pglite-utils/src/utils.ts:70:58)
    at seededPostgres (lib/__tests__/db-seam.test.ts:283:14)
```

All five are PGlite-backed suites belonging to the database lane. **Two notes for the orchestrator,
because they contradict the brief's stated baseline:** the brief lists `agents-route` and
`agents-unconfigured` among five known failures — both **passed** in this run; and the brief says the
smoke test has **nine** guards, while it printed **twelve** plus its completion line. Reported, not
"fixed".

### The lane's own suites, run together

```
$ npx jest llm-endpoint-shape-honesty chat-route-failure-kinds provider-probe-shape-honesty \
           chat-model-list-is-live openai-api-availability openai-api openai-api-no-cloud-fallback
Test Suites: 7 passed, 7 total
Tests:       70 passed, 70 total
```

### Live HTTP against the running dev server on :3000, after the change

Session cookie from `POST /api/auth` → `200 {"ok":true,"role":"owner"}`.

```
GET  /api/chat/models   200  {"base_url":"http://localhost:11434/v1","default_model":"qwen2.5-coder:7b",
                              "models":[{"id":"qwen2.5-coder:14b","trainedContextLength":32768},
                                        {"id":"qwen2.5-coder:32b","trainedContextLength":32768},
                                        {"id":"qwen2.5-coder:7b","trainedContextLength":32768}]}
                             — servedContextLength absent on all three (nothing loaded right now).
                               Unknown still renders as unknown; never backfilled from trained.
GET  /api/health        200  runtimes[openai-api] = {"available":true,"unavailableReason":null}
                               — honest: real Ollama is up and serving three models.
POST /api/chat  modelOverride "anthropic/claude-sonnet-4-5"
                        400  {"error":"unknown model \"anthropic/claude-sonnet-4-5\" — not present
                              in http://localhost:11434/v1/models","id":"anthropic/claude-sonnet-4-5"}
POST /api/chat  {}      200  SSE: data: {"error":"messages array is required"}
```

The happy path and both refusals survived the refactor unchanged.

---

## 10.6 What I did NOT verify, this round

- **No browser, no DOM, no pixel.** The §8 correction about the red banner is a **source trace**
  (`fetch-json.ts` → `ApiError.message` → the JSX at `ChatTab.tsx:1830`/`:2610`), not an observation.
  I did not see it render. The wave-boundary browser pass is still where that gets confirmed.
- **The wrong-endpoint cases still cannot be driven through :3000.** `LLM_BASE_URL` is read at
  module load and nine lanes share that server. Every wrong-endpoint verdict in §10.1/§10.3 is
  module-level over real sockets in a fresh child, plus jest at the route layer. Unchanged from §8.
- **No real non-Ollama server.** The "any OpenAI-compatible API" claim still rests on synthetic
  servers plus shape. No LM Studio, vLLM, llama.cpp, or hosted endpoint was available.
- **Cross-machine portability is unproven.** Windows 11 only. `memory-loop-portable` passes in
  acceptance; that is not the same thing.
- **No end-to-end completion was streamed this round.** The critic streamed one successfully last
  round; I did not repeat it, and I do not restate their measurement as mine.
- **`scripts/lib/env-report.mjs`'s `probeOpenAiShape()` still duplicates this judgement** and still
  was not re-checked against the new verdicts. Not my file; carried forward from §8.
- **`npm run build` was never run** (forbidden). Type safety rests on `npx tsc --noEmit`.

---

## 10.7 The critic's findings, scored against my own measurements

| # | claim | verdict |
|---|---|---|
| gap | `openai-api.ts:136` still carries the defect and `/api/health` publishes it | **CORRECT** — reproduced over real sockets, §10.1 |
| gap | M6/M7 survived; two owned files had zero coverage | **CORRECT** — both reproduced and killed, §10.2 |
| gap | `kind` has zero consumers | **CORRECT** — re-verified at both call sites, §10.4 |
| fab 1 | a 302-to-login lands in `not-openai-compatible`, not `error-status` | **CORRECT** — measured, §10.3 |
| fab 2 | `components/ChatTab.tsx` does not exist; it is `components/tabs/ChatTab.tsx` | **CORRECT** — `ls` |
| fab 3 | the new prose *does* reach the screen; §8 understated | **CORRECT** — traced to the JSX, §10.6 caveat |
| fab 4 | §5.8 gate numbers are stale; tsc is clean | **CORRECT**, and now stale again — §10.5 |

Nothing the critic reported was wrong. The one thing it understated is its own gap: the second
parser was not merely "the same shape of bug", it was the **same bug on the more visible surface**,
and the before/after in §10.1 shows `/api/health` giving four causes one sentence at the moment the
seam one layer down was giving them four.

---

## 10.8 Files changed this round

| file | in this lane? | change |
|---|---|---|
| `lib/llm-provider.ts` | yes | extracted + exported `readModelsResponse()` / `unreachableModelsResult()`; `kind` now required; `/v1` hint made conditional and given a copy-pasteable URL |
| `lib/runtimes/openai-api.ts` | **NO — orchestrator-directed, see §10.1** | hand-rolled parser deleted, now calls the shared helpers; tombstone comment |
| `__tests__/api/llm-endpoint-shape-honesty.test.ts` | yes | 16 → 22 tests (M1, M8, and the one-parser property) |
| `__tests__/api/chat-route-failure-kinds.test.ts` | yes (new) | 9 tests — kills M6 and M7 |
| `__tests__/runtimes/provider-probe-shape-honesty.test.ts` | yes (new) | 10 tests — kills M11, guards `/api/health` |
| this doc | yes | correction blocks in §2, §5, §7, §8; this section |

`app/api/chat/route.ts`, `app/api/chat/autotitle/route.ts` and `app/api/chat/models/route.ts` were
**not modified** this round — they were mutated, measured, and restored to byte-identical md5s. No
change was needed in `app/page.tsx` or `components/nav/config.ts`; §6 still stands.

## 10.9 Fixtures, round 2

**None created, none deleted.** No `Limiglow` row was written or read-modified; `TOD-1` was never
touched. Both `POST /api/chat` probes carried no `conversationId`, and the route gates its only
writes on `conversationId && fullContent` (`route.ts:168`). `POST /api/auth` sets cookies only. All
probe HTTP servers (`19831-19832`, `19841-19846`) were shut down; `netstat` confirms no listener
remains on any of them.
