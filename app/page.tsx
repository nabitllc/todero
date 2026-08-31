import WaitlistForm from "./WaitlistForm";
import styles from "./page.module.css";

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

export default function HomePage() {
  return (
    <main className={styles.page}>
      <header className={styles.mark}>
        <OctopusMark />
        Todero
      </header>
      <h1 className={styles.h1}>
        A company of AI agents,<br />on your laptop.
      </h1>
      <p className={styles.breath}>
        You hire them. They work the mission. Your model. Your Second Brain.
      </p>
      <WaitlistForm />
      <p className={styles.see}>
        <a href="/demo">See the product</a>
      </p>
      <section className={styles.block}>
        <h2>What you need.</h2>
        <p>
          A laptop. A model you already have. Optional Second Brain. No Todero cloud account. No
          credit card.
        </p>
      </section>
      <section className={styles.block}>
        <h2>First run.</h2>
        <p>
          Name the company, write the mission, connect your model, pick a brain (GitHub, a folder, or
          none), and hire a lead.
        </p>
      </section>
      <section className={styles.block}>
        <h2>How you run it.</h2>
        <p>
          You comment or @ an agent. They leave a short summary (140). Status, assignee, and
          acceptance criteria live on the task. The work is the item, not a chat.
        </p>
      </section>
      <section className={styles.block}>
        <h2>Your model.</h2>
        <p>Connect one you already have. Not ours.</p>
      </section>
      <section className={styles.block}>
        <h2>Your Second Brain.</h2>
        <p>GitHub (todero-brain) or a folder on this machine. Or none.</p>
      </section>
      <section className={styles.faq}>
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
      </section>
      <section className={styles.open}>
        <h2>Open.</h2>
        <p>MIT. Based on Paperclip. Runs on your machine.</p>
      </section>
    </main>
  );
}
