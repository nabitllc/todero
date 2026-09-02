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

export default function HomePage() {
  return (
    <div className={`${styles.page} ${sans.variable} ${mono.variable}`}>
      <header className={styles.top}>
        <span className={styles.brand}>
          <OctopusMark />
          Todero
        </span>
        <nav className={styles.nav} aria-label="Site">
          <a className={styles.navLink} href="/demo">
            Product
          </a>
        </nav>
      </header>

      <main className={styles.hero} aria-labelledby="hero-title">
        <Octopus />
        <div className={styles.words}>
          <h1 className={styles.h1} id="hero-title">
            A company of AI agents,
            <br />
            on your laptop.
          </h1>
          <p className={styles.breath}>
            You hire them. They work the mission. Your model. Your Second Brain.
          </p>
        </div>
        <div className={styles.action}>
          <WaitlistForm />
          <a className={styles.see} href="/demo">
            See the product
            <span aria-hidden={true}>→</span>
          </a>
        </div>
        <p className={styles.strip}>
          <span>Local</span>
          <span>Your model</span>
          <span>MIT</span>
          <span>macOS, Windows, Linux</span>
        </p>
      </main>

      <footer className={styles.foot}>
        <span>Todero</span>
        <span>Based on Paperclip (MIT)</span>
        <a className={styles.footLink} href="/progress">
          Board
        </a>
      </footer>
    </div>
  );
}
