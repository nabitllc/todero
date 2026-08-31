"use client";

import { FormEvent, useId, useState } from "react";
import styles from "./page.module.css";

type Status = "idle" | "submitting" | "success" | "error";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const errorId = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter an email address.");
      setStatus("error");
      return;
    }
    setError("");
    setStatus("submitting");
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error || "Could not join the waitlist.");
      setStatus("error");
      return;
    }
    setStatus("success");
  }

  if (status === "success") {
    return (
      <p className={styles.success} aria-live="polite">
        You’re on the list.
      </p>
    );
  }

  return (
    <form className={styles.waitlist} onSubmit={onSubmit} noValidate>
      <label className={styles.label} htmlFor="waitlist-email">
        Email
      </label>
      <div className={styles.field}>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={status === "error"}
          aria-describedby={status === "error" ? errorId : undefined}
          disabled={status === "submitting"}
        />
        <button type="submit" disabled={status === "submitting"}>
          Join the waitlist
        </button>
      </div>
      {status === "error" ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : (
        <p className={styles.helper}>We’ll email you when install is one command.</p>
      )}
    </form>
  );
}
