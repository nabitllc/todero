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
      <p className={styles.cta}>
        <a href="/progress">Product board</a>
      </p>
      <figure className={styles.shot}>
        <img
          src="/landing-work-item.png"
          alt="Todero task TESA-1 — the work item, not a chat."
        />
      </figure>
      <p className={styles.caption}>The work is the item, not a chat.</p>
      <section className={styles.block}>
        <h2>Your model.</h2>
        <p>Connect one you already have. Not ours.</p>
      </section>
      <section className={styles.block}>
        <h2>Your Second Brain.</h2>
        <p>GitHub (todero-brain) or a folder on this machine. Or none.</p>
      </section>
      <footer className={styles.footer}>Based on Paperclip (MIT)</footer>
    </main>
  );
}
