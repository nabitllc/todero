import WaitlistForm from "./WaitlistForm";
import styles from "./page.module.css";

function OctopusMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={28}
      height={28}
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

const rows = [
  {
    title: "First run.",
    body: "Name the company, write the mission, connect your model, pick a brain (GitHub, a folder, or none), and hire a lead.",
  },
  {
    title: "How you run it.",
    body: "You comment or @ an agent. They leave a short summary (140). Status, assignee, and acceptance criteria live on the task. The work is the item, not a chat.",
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

export default function HomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <OctopusMark />
        Todero
      </header>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1 className={styles.h1}>
            A company of AI agents,
            <br />
            on your laptop.
          </h1>
          <p className={styles.breath}>
            You hire them. They work the mission. Your model. Your Second Brain.
          </p>
          <WaitlistForm />
          <p className={styles.see}>
            <a href="/demo">See the product</a>
          </p>
        </div>
        <figure className={styles.shot}>
          <img
            src="/landing-work-item.png"
            alt="Todero task TESA-1 — the work item, not a chat."
          />
        </figure>
      </section>
      <section className={styles.bands}>
        <div className={styles.bandsInner}>
          <article className={styles.statement}>
            <h2>What you need.</h2>
            <p>
              A laptop. A model you already have. Optional Second Brain. No Todero cloud account. No
              credit card.
            </p>
          </article>
          {rows.map((row) => (
            <article className={styles.band} key={row.title}>
              <h2>{row.title}</h2>
              <p>{row.body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.faqBand}>
        <div className={styles.faqInner}>
          <div>
            <h2>Windows?</h2>
            <p>Yes.</p>
          </div>
          <div>
            <h2>Local only?</h2>
            <p>Yes. Your laptop.</p>
          </div>
          <div>
            <h2>Cost?</h2>
            <p>Your model’s tokens. Not a Todero bill.</p>
          </div>
          <div>
            <h2>Need GitHub?</h2>
            <p>No. The brain is optional.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
