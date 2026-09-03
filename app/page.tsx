import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Octopus from "./Octopus";
import WaitlistForm from "./WaitlistForm";
import styles from "./page.module.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

function OctopusMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d="M7.5 12c0-3.1 2-5.5 4.5-5.5s4.5 2.4 4.5 5.5c0 1.8-1.3 3.2-3 3.2h-3C8.8 15.2 7.5 13.8 7.5 12z" />
      <circle cx="10.3" cy="10.7" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="13.7" cy="10.7" r="0.85" fill="currentColor" stroke="none" />
      <path d="M9 15.3c-1.1 2.3-2.8 3.5-2.2 5.2" />
      <path d="M11 15.4c-.5 2.2-1.1 4 .4 5.1" />
      <path d="M13 15.4c.5 2.2 1.1 4-.4 5.1" />
      <path d="M15 15.3c1.1 2.3 2.8 3.5 2.2 5.2" />
      <path d="M8 13.4c-2.3.6-3.7 1.6-3.3 3.6" />
      <path d="M16 13.4c2.3.6 3.7 1.6 3.3 3.6" />
    </svg>
  );
}

const facts = [
  {
    title: "What you need.",
    body: "A laptop. A model you already have. Optional Second Brain. No Todero cloud account. No credit card.",
  },
  {
    title: "First run.",
    body: "Name the company, write the mission, connect your model, pick a brain, hire a lead.",
  },
  {
    title: "How you run it.",
    body: "Comment or @ an agent. The work is the item, not a chat.",
  },
  {
    title: "Your model.",
    body: "Connect one you already have. Not ours.",
  },
  {
    title: "Your Second Brain.",
    body: "GitHub (todero-brain) or a folder on this machine. Or none.",
  },
  {
    title: "Open.",
    body: "MIT. Based on Paperclip. Runs on your machine.",
  },
];

const faq = [
  { q: "Windows?", a: "Yes." },
  { q: "Local only?", a: "Yes. Your laptop." },
  { q: "Cost?", a: "Your model’s tokens. Not a Todero bill." },
  { q: "Need GitHub?", a: "No. The brain is optional." },
];

export default function HomePage() {
  return (
    <div className={`${styles.page} ${sans.variable} ${mono.variable}`}>
      <header className={styles.top}>
        <a className={styles.brand} href="/">
          <OctopusMark />
          Todero
        </a>
        <nav className={styles.nav} aria-label="Site">
          <a className={styles.navLink} href="/demo">
            Product
          </a>
          <a className={styles.navLink} href="/progress">
            Board
          </a>
        </nav>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="hero-title">
          <Octopus />
          <h1 className={styles.h1} id="hero-title">
            A company of AI agents,
            <br />
            on your laptop.
          </h1>
          <p className={styles.breath}>
            You hire them. They work the mission. Your model. Your Second Brain.
          </p>
          <div className={styles.action}>
            <WaitlistForm />
          </div>
        </section>

        <section className={styles.facts} aria-label="About Todero">
          {facts.map((fact) => (
            <article className={styles.fact} key={fact.title}>
              <h2 className={styles.factTitle}>{fact.title}</h2>
              <p className={styles.factBody}>{fact.body}</p>
            </article>
          ))}
        </section>

        <section className={styles.faq} aria-label="Questions">
          <dl className={styles.faqList}>
            {faq.map((item) => (
              <div className={styles.faqItem} key={item.q}>
                <dt className={styles.faqQ}>{item.q}</dt>
                <dd className={styles.faqA}>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className={styles.foot}>
        <span>Todero</span>
        <span>Based on Paperclip (MIT)</span>
      </footer>
    </div>
  );
}
