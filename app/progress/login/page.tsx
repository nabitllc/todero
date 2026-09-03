import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { LoginForm } from "./LoginForm";
import { OctopusMark } from "../Mark";
import styles from "../progress.module.css";

export const metadata: Metadata = {
  title: "Progress · Todero",
  robots: { index: false, follow: false },
};

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export default function LoginPage() {
  return (
    <div className={`todero ${styles.page} ${sans.variable} ${mono.variable}`}>
      <main className={styles.gate}>
        <span className={styles.gateMark}>
          <OctopusMark size={28} />
        </span>
        <h1 className={styles.gateTitle}>Progress</h1>
        <p className={styles.gateNote}>Internal. One password.</p>
        <LoginForm />
      </main>
    </div>
  );
}
