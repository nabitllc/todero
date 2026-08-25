#!/usr/bin/env node
// Regenerates the Todero flight board.
//
// Run this at the end of every wave, then republish the artifact. The board is
// generated rather than hand-edited so a wave cannot land without its numbers
// being refreshed from the same sources the critics use:
//   · scripts/acceptance/run.mjs --json   → the measured harness
//   · scripts/board/waves.json            → per-wave before/after, cost, time
//   · scripts/board/channels.json         → judged channel scores and goals
//
//   node scripts/board/build-board.mjs [--out <path>]
//
// CANONICAL OUTPUT — there is exactly ONE flight board. It lives at one artifact
// URL and is republished in place; --out only chooses where the generated HTML is
// staged before publishing. Never publish a second board file under a new name:
// a second URL means two boards disagreeing about the same program.

import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outIdx = process.argv.indexOf('--out')
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : join(here, 'flight-board.html')

const esc = (s) => String(s ?? '').replace(/&(?![a-z#]+;)/g, '&amp;').replace(/</g, '&lt;')
const num = (n) => n.toLocaleString('en-US')
const money = (n) => '$' + n.toFixed(n < 10 ? 1 : 0)
const mins = (m) => (m == null ? 'running' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)
const tok = (t) => (t >= 1e6 ? (t / 1e6).toFixed(2) + 'M' : t >= 1e3 ? Math.round(t / 1e3) + 'k' : String(t))

const waves = JSON.parse(await readFile(join(here, 'waves.json'), 'utf8'))
const channels = JSON.parse(await readFile(join(here, 'channels.json'), 'utf8'))

// ── live harness ────────────────────────────────────────────────────────────
let harness = { passed: 0, total: 0, score: 0, criticalFailed: 0, results: [] }
try {
  const { stdout } = await exec('node', [join(root, 'scripts/acceptance/run.mjs'), '--json'],
    { cwd: root, timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
  harness = JSON.parse(stdout)
} catch (e) {
  // A non-zero exit is normal — the runner exits with the failure count.
  try { harness = JSON.parse(String(e.stdout || '')) } catch { /* leave the zeroed default */ }
}

// ── totals ──────────────────────────────────────────────────────────────────
const T = waves.waves.reduce((a, w) => ({
  agents: a.agents + w.agents, tokens: a.tokens + w.tokens,
  cost: a.cost + w.cost, minutes: a.minutes + (w.minutes ?? 0),
}), { agents: 0, tokens: 0, cost: 0, minutes: 0 })

const cur = channels.channels.reduce((s, c) => s + c.current, 0) / channels.channels.length
const base = channels.channels.reduce((s, c) => s + c.baseline, 0) / channels.channels.length
const cleared = channels.channels.filter(c => c.current >= c.goal).length

// ── channel cards ───────────────────────────────────────────────────────────
const chipFor = (c) => {
  if (c.current >= c.goal) return ['cleared', 'goal cleared']
  if (c.wave) return ['building', `wave ${c.wave}`]
  if (c.current === c.baseline) return ['untouched', 'not started']
  return ['moving', 'in progress']
}
const cards = [...channels.channels]
  .sort((a, b) => (b.current - b.goal) - (a.current - a.goal))
  .map(c => {
    const [cls, label] = chipFor(c)
    const d = c.current - c.baseline
    const dtxt = d > 0 ? `+${d.toFixed(1)}` : d === 0 ? '=' : d.toFixed(1)
    return `      <div class="card">
        <div class="head"><span class="cname">${esc(c.name)}</span><span class="chip ${cls}">${esc(label)}</span></div>
        <div class="meter">
          <div class="bar"><div class="ghost" style="width:${c.baseline * 10}%"></div><div class="fill" style="width:${c.current * 10}%"></div><div class="pin" style="left:${c.goal * 10}%"></div></div>
          <span class="mnum">${c.current.toFixed(1)}<i>/${c.goal}</i></span>
        </div>
        <div class="gap"><b>[${dtxt}]</b> ${esc(c.evidence)}</div>
        <div class="goal"><span class="glab">Goal</span> ${esc(c.goal_text)}</div>
      </div>`
  }).join('\n')

// ── waves ───────────────────────────────────────────────────────────────────
const li = (xs) => xs.map(x => `<li>${x}</li>`).join('')
const waveBlocks = waves.waves.slice().reverse().map(w => `      <div class="wave ${w.chip}" id="wave-${w.n}">
        <div class="whead">
          <span class="wn">Wave ${w.n}</span>
          <span class="wname">${esc(w.name)}</span>
          <span class="chip ${w.chip === 'running' ? 'building' : 'cleared'}">${w.chip === 'running' ? 'running' : 'complete'}</span>
          <span class="wwhen">${esc(w.when)}</span>
        </div>
        <p class="wlede">${esc(w.lede)}</p>
        <div class="spend">
          <span><i>time</i>${mins(w.minutes)}</span>
          <span><i>agents</i>${w.agents || '—'}</span>
          <span><i>tokens</i>${w.tokens ? tok(w.tokens) : '—'}</span>
          <span><i>est. cost</i>${w.cost ? money(w.cost) : '—'}</span>
        </div>
        <div class="ba">
          <div><div class="balab before">Before</div><ul>${li(w.before)}</ul></div>
          <div class="aft"><div class="balab after">After</div><ul>${li(w.after)}</ul></div>
        </div>
      </div>`).join('\n')

const plannedBlocks = waves.planned.map(p => `        <div class="pw"><span class="pn">Wave ${p.n}</span><span class="pname">${esc(p.name)}</span><span class="pd">${esc(p.detail)}</span></div>`).join('\n')

// ── harness rows, grouped and collapsed ─────────────────────────────────────
const byPiece = {}
for (const r of harness.results) (byPiece[r.piece] ??= []).push(r)
const groups = Object.entries(byPiece).map(([piece, rows]) => {
  const bad = rows.filter(r => !r.ok).length
  const state = bad === 0 ? 'ok' : rows.some(r => !r.ok && r.critical) ? 'crit' : 'warn'
  return `        <details class="grp ${state}"${bad ? ' open' : ''}>
          <summary><span class="gname">${esc(piece)}</span><span class="gcount">${rows.length - bad}/${rows.length}</span></summary>
          ${rows.map(r => `<div class="chk ${r.ok ? 'ok' : r.critical ? 'crit' : 'warn'}"><span class="cid">${esc(r.id)}</span><span class="cdet">${esc(r.detail)}</span></div>`).join('\n          ')}
        </details>`
}).join('\n')

// ── page ────────────────────────────────────────────────────────────────────
const html = `<title>Todero Flight Board</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--ground:#F4F6F5;--panel:#FFF;--panel2:#EAEEEE;--rule:#D2DAD9;--soft:#E2E8E7;--ink:#0F1719;--ink2:#3D4C50;--ink3:#6C7F84;--go:#1E9E63;--wip:#B87514;--nogo:#C0392F;--bench:#5C7A8C;--track:#DDE4E3;--sh:0 1px 2px rgba(15,23,25,.06),0 8px 24px -14px rgba(15,23,25,.2)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#0B1014;--panel:#121A1F;--panel2:#18232A;--rule:#26343B;--soft:#1D282E;--ink:#E8EFEF;--ink2:#A8BCC0;--ink3:#6E858C;--go:#35C77E;--wip:#E9A03C;--nogo:#DF4E45;--bench:#7FA3B5;--track:#1E2A31;--sh:0 1px 2px rgba(0,0,0,.4),0 12px 32px -18px rgba(0,0,0,.7)}}
:root[data-theme="dark"]{--ground:#0B1014;--panel:#121A1F;--panel2:#18232A;--rule:#26343B;--soft:#1D282E;--ink:#E8EFEF;--ink2:#A8BCC0;--ink3:#6E858C;--go:#35C77E;--wip:#E9A03C;--nogo:#DF4E45;--bench:#7FA3B5;--track:#1E2A31;--sh:0 1px 2px rgba(0,0,0,.4),0 12px 32px -18px rgba(0,0,0,.7)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:26px 20px 90px}
@media(max-width:640px){.wrap{padding:16px 14px 70px}}
h1,h2,h3,.cond{font-family:"IBM Plex Sans Condensed","IBM Plex Sans",sans-serif;text-wrap:balance}
.mono,code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
code{background:var(--panel2);padding:1px 5px;border-radius:2px;font-size:.88em}
a{color:inherit;text-decoration:none}
:focus-visible{outline:2px solid var(--wip);outline-offset:2px}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3)}

header{padding-bottom:14px;border-bottom:2px solid var(--ink)}
h1{margin:4px 0 0;font-size:clamp(28px,6vw,46px);font-weight:700;letter-spacing:-.02em;line-height:1}
.sub{color:var(--ink2);font-size:14px;margin:7px 0 0;max-width:64ch}

.band{display:flex;flex-wrap:wrap;gap:9px 26px;align-items:baseline;padding:14px 0 16px;border-bottom:1px solid var(--rule)}
.band .kv{display:flex;gap:8px;align-items:baseline}
.band .k{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.band .v{font-weight:600;font-size:14px}
.band .v.mono{font-weight:500}
.pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--wip);margin-right:7px;animation:pl 1.6s ease-in-out infinite}
@keyframes pl{0%,100%{opacity:.35}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){.pulse{animation:none}}

nav.index{display:flex;flex-wrap:wrap;gap:8px;padding:16px 0 4px}
nav.index a{font-family:"IBM Plex Mono",monospace;font-size:11.5px;letter-spacing:.06em;color:var(--ink2);border:1px solid var(--rule);border-radius:3px;padding:6px 11px;background:var(--panel)}
nav.index a:hover{border-color:var(--ink3);color:var(--ink)}
nav.index a i{font-style:normal;color:var(--ink3);margin-left:7px}

section{margin-top:42px;scroll-margin-top:16px}
.shead{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule);padding-bottom:7px}
.shead h2{margin:0;font-size:20px;font-weight:700}
.shead .note{font-size:12.5px;color:var(--ink3);margin-left:auto;text-align:right}
@media(max-width:640px){.shead{flex-wrap:wrap}.shead .note{margin-left:0;text-align:left;width:100%}}
.lede{color:var(--ink2);font-size:13.5px;margin:12px 0 0;max-width:76ch}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:13px;margin-top:14px}
.card{background:var(--panel);border:1px solid var(--rule);border-radius:5px;padding:13px 15px 12px;box-shadow:var(--sh);display:flex;flex-direction:column;gap:9px}
.head{display:flex;align-items:baseline;justify-content:space-between;gap:9px}
.cname{font-family:"IBM Plex Sans Condensed",sans-serif;font-size:16.5px;font-weight:600;line-height:1.2}
.chip{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:2px;border:1px solid currentColor;white-space:nowrap;flex-shrink:0}
.chip.cleared{color:var(--go)}.chip.building{color:var(--wip)}.chip.moving{color:var(--bench)}.chip.untouched{color:var(--nogo)}
.meter{display:flex;align-items:center;gap:11px}
.bar{flex:1;height:8px;background:var(--track);border-radius:2px;position:relative;overflow:hidden}
.ghost{position:absolute;inset:0 auto 0 0;background:var(--ink3);opacity:.3}
.fill{position:absolute;inset:0 auto 0 0;background:var(--wip);border-radius:2px}
.card:has(.chip.cleared) .fill{background:var(--go)}
.pin{position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--bench)}
.mnum{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:600;min-width:56px;text-align:right}
.mnum i{font-style:normal;font-weight:400;font-size:11px;color:var(--ink3)}
.gap{font-size:13px;color:var(--ink2);line-height:1.5}
.gap b{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink);margin-right:3px}
.goal{font-size:12.5px;color:var(--ink2);line-height:1.5;border-left:2px solid var(--bench);padding-left:9px;margin-top:1px}
.glab{font-family:"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--bench);margin-right:6px}

.wave{border-left:2px solid var(--rule);padding:0 0 26px 20px;position:relative;margin-top:20px}
.wave::before{content:"";position:absolute;left:-6px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--ground);border:2px solid var(--rule)}
.wave.done::before{background:var(--go);border-color:var(--go)}
.wave.running::before{background:var(--wip);border-color:var(--wip)}
.wave.running{border-left-color:var(--wip)}
.whead{display:flex;flex-wrap:wrap;align-items:baseline;gap:9px}
.wn{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.wname{font-family:"IBM Plex Sans Condensed",sans-serif;font-size:19px;font-weight:700}
.wwhen{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink3);margin-left:auto}
@media(max-width:640px){.wwhen{margin-left:0;width:100%}}
.wlede{margin:7px 0 0;color:var(--ink2);font-size:13.5px;max-width:74ch}
.spend{display:flex;flex-wrap:wrap;gap:1px;background:var(--soft);border:1px solid var(--soft);border-radius:3px;margin-top:12px;overflow:hidden}
.spend span{background:var(--panel);padding:8px 14px;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:600;flex:1;min-width:96px}
.spend i{display:block;font-style:normal;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);font-weight:400;margin-bottom:2px}
.ba{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--soft);border:1px solid var(--soft);border-radius:3px;margin-top:10px;overflow:hidden}
@media(max-width:600px){.ba{grid-template-columns:1fr}}
.ba>div{background:var(--panel);padding:11px 14px}
.balab{font-family:"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:6px}
.balab.before{color:var(--ink3)}
.balab.after{color:var(--go)}
.ba ul{margin:0;padding-left:16px;font-size:13px;line-height:1.55;color:var(--ink3)}
.ba .aft ul{color:var(--ink2)}
.ba li{margin-bottom:3px}
.ba b{color:var(--ink);font-weight:600}

.pw{display:grid;grid-template-columns:78px 200px 1fr;gap:14px;padding:11px 2px;border-bottom:1px solid var(--soft);align-items:baseline}
@media(max-width:720px){.pw{grid-template-columns:78px 1fr}.pw .pd{grid-column:1/-1}}
.pn{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.pname{font-family:"IBM Plex Sans Condensed",sans-serif;font-size:15px;font-weight:600}
.pd{font-size:12.5px;color:var(--ink3);line-height:1.5}

.grp{border:1px solid var(--rule);border-radius:4px;background:var(--panel);margin-top:8px;overflow:hidden}
.grp summary{cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:10px;list-style:none;font-size:13.5px}
.grp summary::-webkit-details-marker{display:none}
.grp summary::before{content:"▸";font-size:10px;color:var(--ink3);transition:transform .15s}
.grp[open] summary::before{transform:rotate(90deg)}
.gname{font-family:"IBM Plex Mono",monospace;font-size:12px;flex:1}
.gcount{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--ink3)}
.grp.ok .gcount{color:var(--go)}
.grp.warn .gcount{color:var(--wip)}
.grp.crit{border-color:var(--nogo)}
.grp.crit .gcount{color:var(--nogo)}
.chk{display:grid;grid-template-columns:210px 1fr;gap:12px;padding:7px 14px 7px 34px;border-top:1px solid var(--soft);font-size:12.5px}
@media(max-width:640px){.chk{grid-template-columns:1fr;gap:2px}}
.cid{font-family:"IBM Plex Mono",monospace;font-size:11.5px}
.chk.ok .cid{color:var(--go)}
.chk.warn .cid{color:var(--wip)}
.chk.crit .cid{color:var(--nogo)}
.cdet{color:var(--ink3);word-break:break-word}

.method{background:var(--panel);border:1px solid var(--rule);border-radius:5px;padding:16px 19px;margin-top:14px;max-width:80ch}
.method p{margin:9px 0;font-size:13.5px;color:var(--ink2);line-height:1.6}
.method p:first-child{margin-top:0}
.method b{color:var(--ink)}
.foot{margin-top:44px;padding-top:14px;border-top:1px solid var(--rule);font-size:12.5px;color:var(--ink3);line-height:1.6}
</style>

<div class="wrap">
<header>
  <div class="eyebrow">Todero · Mission Control · rebuild program</div>
  <h1>Flight Board</h1>
  <p class="sub">Live scoring of Todero against the best mission controls people actually build and buy. Waves keep running until Todero wins.</p>
</header>

<div class="band">
  <div class="kv"><span class="k">Wave</span><span class="v">3</span></div>
  <div class="kv"><span class="k">Phase</span><span class="v"><span class="pulse"></span>Truth — 8 pieces, harness-gated</span></div>
  <div class="kv"><span class="k">Harness</span><span class="v mono">${waves.harnessHistory.filter(h => h.score).map(h => h.score).join(' → ')}</span></div>
  <div class="kv"><span class="k">Channels</span><span class="v mono">${base.toFixed(1)} → ${cur.toFixed(1)} (goal ${channels.goalAvg})</span></div>
  <div class="kv"><span class="k">Spent</span><span class="v mono">${tok(T.tokens)} tok · ~${money(T.cost)}</span></div>
  <div class="kv"><span class="k">Fleet</span><span class="v">Opus / Sonnet / Haiku — tiered</span></div>
</div>

<nav class="index">
  <a href="#channels">Channels<i>${cleared}/${channels.channels.length} cleared</i></a>
  <a href="#waves">Waves<i>${waves.waves.length} run</i></a>
  <a href="#next">What's next<i>${waves.planned.length} queued</i></a>
  <a href="#harness">Harness<i>${harness.passed}/${harness.total}</i></a>
  <a href="#method">Method</a>
  <a href="#ledger">Ledger<i>~${money(T.cost)}</i></a>
</nav>

<section id="channels">
  <div class="shead"><h2>Channels</h2><div class="note">Sorted by distance from goal · ${cleared} of ${channels.channels.length} cleared</div></div>
  <p class="lede">Solid bar is where Todero is now; the ghost behind it is where it started; the pin is the goal it has to meet or beat. Each goal names the tool and the feature it is measured against. <b>These are judged</b>, not measured — a fresh blind panel re-scores all ${channels.channels.length} at Wave 8, and that is the number that decides whether the program loops.</p>
  <div class="grid">
${cards}
  </div>
</section>

<section id="waves">
  <div class="shead"><h2>Waves</h2><div class="note">Newest first. No fixed round count.</div></div>
${waveBlocks}
</section>

<section id="next">
  <div class="shead"><h2>What's next</h2><div class="note">Queued, in order</div></div>
  <div style="margin-top:10px">
${plannedBlocks}
  </div>
</section>

<section id="harness">
  <div class="shead"><h2>Harness</h2><div class="note">Measured, not judged · <code>node scripts/acceptance/run.mjs</code></div></div>
  <p class="lede">Every acceptance criterion as an executable check, written before the work and never by the builder graded against it. Runs in seconds, so it runs after every piece — which is what catches a regression in the round it happens. Groups with a failure are open; the rest are collapsed.</p>
  <div style="margin-top:6px">
${groups}
  </div>
</section>

<section id="method">
  <div class="shead"><h2>Method</h2><div class="note">How a piece gets certified</div></div>
  <div class="method">
    <p><b>Cheap checks first.</b> A piece is built, then the deterministic harness runs. Only when the script is green does a frontier critic look at it — and it judges only what a script cannot: whether the result is honest, and whether it beats the named comparator. Wave 2 skipped this layer and spent frontier tokens answering questions <code>curl</code> could have answered.</p>
    <p><b>The grader is written by the orchestrator.</b> Never by the builder being graded. A loop optimises whatever signal it is given, and a builder that writes its own check learns to write one it already passes.</p>
    <p><b>Real loop bounds.</b> Each piece gets at most 3 rounds, and halts early after two rounds with no improvement rather than burning the third. These are <code>for</code> loops in the orchestration script, not instructions in a prompt — a prompt-level stop is documentation of intent, not a control.</p>
    <p><b>Nothing is certified twice.</b> A piece that passed once is re-verified by every later wave. One fix landed, was verified, and was silently reverted an hour later; the harness now catches that class in seconds.</p>
  </div>
</section>

<section id="ledger">
  <div class="shead"><h2>Ledger</h2><div class="note">What the program has cost</div></div>
  <div class="spend" style="margin-top:12px">
    <span><i>wall clock</i>${mins(T.minutes)}</span>
    <span><i>agents</i>${T.agents}</span>
    <span><i>subagent tokens</i>${tok(T.tokens)}</span>
    <span><i>est. cost</i>~${money(T.cost)}</span>
    <span><i>waves</i>${waves.waves.length}</span>
  </div>
  <p class="foot" style="margin-top:14px;border:0;padding:0">
    <b style="color:var(--ink)">How the cost figure is made, since the board should hold itself to its own rule.</b>
    Token counts are measured from the workflow journals. Dollars are an <b style="color:var(--ink)">estimated upper bound</b>: tokens split at roughly 88% input / 12% output, priced at Opus 5 rates ($5/$25 per Mtok) for Waves 1–2 and at a blended Sonnet/Haiku/Opus rate for Wave 3 onward, which is tiered. Prompt caching is not modelled and would reduce the real figure materially. Treat it as a ceiling, not an invoice.
  </p>
</section>

<p class="foot">
  Scores are deliberately harsh. A surface that renders but returns <code>403</code>, <code>500</code>, or an empty state scores zero — having a tab for something is worth nothing here. This page is regenerated from live data at the end of each wave by <code>scripts/board/build-board.mjs</code>; refresh to pick up the latest.
</p>
</div>
`

await writeFile(outPath, html)
console.log(`board written → ${outPath}`)
console.log(`  harness ${harness.passed}/${harness.total} (${harness.score}/10, ${harness.criticalFailed} critical)`)
console.log(`  channels ${base.toFixed(1)} → ${cur.toFixed(1)} / ${channels.goalAvg} · ${cleared} cleared`)
console.log(`  spend ${tok(T.tokens)} tok · ~${money(T.cost)} · ${T.agents} agents`)
