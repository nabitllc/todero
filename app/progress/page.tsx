import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { landed, openPulls, type Entry as LandedEntry } from "../../lib/progress/github";
import { progressEnv } from "../../lib/progress/session";
import { logout } from "./login/actions";
import { OctopusMark } from "./Mark";
import styles from "./progress.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Progress · Todero",
  robots: { index: false, follow: false },
};

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const number = new Intl.NumberFormat("en-US");
const BOTS = /\[bot\]$|^dependabot/i;
const PULLS_URL = "https://github.com/nabitllc/todero/pulls";

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
}

function costOf(e: LandedEntry): string {
  if (e.tokens === null && e.usd === null) return "cost —";
  const parts = [e.tokens !== null ? `${tokens(e.tokens)} tokens` : null, e.usd !== null ? `$${e.usd.toFixed(2)}` : null];
  return `cost ${parts.filter(Boolean).join(" · ")}`;
}

function Entry({ entry }: { entry: LandedEntry }) {
  return (
    <article className={styles.entry}>
      <div className={styles.entryHead}>
        <a className={styles.number} href={entry.url}>
          {entry.label}
        </a>
        <h3 className={styles.title}>
          <a href={entry.url}>{entry.title}</a>
        </h3>
      </div>
      {entry.summary ? <p className={styles.summary}>{entry.summary}</p> : null}
      <p className={styles.meta}>
        <span className={styles.delta}>
          +{number.format(entry.additions)} −{number.format(entry.deletions)} · {entry.changedFiles} {entry.changedFiles === 1 ? "file" : "files"}
        </span>
        <span>{costOf(entry)}</span>
        {entry.proof ? (
          <a className={styles.proof} href={entry.proof}>
            proof ↗
          </a>
        ) : null}
      </p>
      <p className={styles.who}>
        <span>{entry.area}</span>
        <span>{entry.session ?? entry.author}</span>
        <span>{timeFormat.format(new Date(entry.at))}</span>
      </p>
    </article>
  );
}

function byDay(entries: LandedEntry[]): Array<[string, LandedEntry[]]> {
  const map = new Map<string, LandedEntry[]>();
  for (const e of entries) {
    const k = dayFormat.format(new Date(e.at));
    map.set(k, [...(map.get(k) ?? []), e]);
  }
  return [...map.entries()];
}

export default async function ProgressPage() {
  const env = progressEnv();
  let merged: LandedEntry[] = [];
  let open: LandedEntry[] = [];
  let problem: string | null = null;
  if (!env) {
    problem = "Progress isn’t configured on this deployment.";
  } else {
    try {
      [merged, open] = await Promise.all([landed(env.token), openPulls(env.token)]);
    } catch (error) {
      console.error("progress: GitHub fetch failed", error);
      problem = "GitHub is unreachable right now. Try again in a minute.";
    }
  }
  const people = open.filter((p) => !BOTS.test(p.author));
  const bots = open.length - people.length;

  return (
    <div className={`todero ${styles.page} ${sans.variable} ${mono.variable}`}>
      <header className={styles.top}>
        <h1 className={styles.brand}>
          <OctopusMark />
          Todero · Progress
        </h1>
        <form action={logout}>
          <button className={styles.link} type="submit">
            Sign out
          </button>
        </form>
      </header>

      <main className={styles.main}>
        {problem ? <p className={styles.problem}>{problem}</p> : null}

        <section className={styles.now} aria-labelledby="now-title">
          <h2 className={styles.dayTitle} id="now-title">
            Now
          </h2>
          {people.length === 0 && bots === 0 ? <p className={styles.empty}>Nothing open.</p> : null}
          {people.length > 0 ? (
            <ul className={styles.nowList}>
              {people.map((p) => (
                <li key={p.label} className={styles.nowItem}>
                  <a className={styles.number} href={p.url}>
                    {p.label}
                  </a>
                  <a className={styles.nowTitle} href={p.url}>
                    {p.title}
                  </a>
                  <span className={styles.area}>{p.draft ? "draft" : p.area}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {bots > 0 ? (
            <p className={styles.empty}>
              <a className={styles.proof} href={`${PULLS_URL}?q=is%3Apr+is%3Aopen+author%3Aapp%2Fdependabot`}>
                {bots} dependency {bots === 1 ? "bump" : "bumps"} open ↗
              </a>
            </p>
          ) : null}
        </section>

        {merged.length === 0 && !problem ? <p className={styles.empty}>Nothing landed in the last 90 days.</p> : null}
        {byDay(merged).map(([day, entries]) => (
          <section className={styles.day} key={day} aria-label={day}>
            <h2 className={styles.dayTitle}>{day}</h2>
            {entries.map((e) => (
              <Entry key={e.label} entry={e} />
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
