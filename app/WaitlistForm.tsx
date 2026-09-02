"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import styles from "./page.module.css";

type Status = "idle" | "submitting" | "success" | "error";

const HELP = "One email when npx todero works. Nothing else.";
const INVALID = "Enter an email address.";
const UNAVAILABLE =
  "Couldn’t join the waitlist. The list service didn’t respond. Try again in a minute.";
const OFFLINE = "Couldn’t reach Todero. Check your connection and try again.";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const inputId = useId();
  const helpId = useId();
  const successRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (status === "success") successRef.current?.focus();
  }, [status]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
    if (!looksLikeEmail(email)) {
      setError(INVALID);
      setStatus("error");
      return;
    }
    setError("");
    setStatus("submitting");
    let res: Response;
    try {
      res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      setError(OFFLINE);
      setStatus("error");
      return;
    }
    if (!res.ok) {
      setError(res.status === 400 ? INVALID : UNAVAILABLE);
      setStatus("error");
      return;
    }
    setStatus("success");
  }

  if (status === "success") {
    return (
      <p className={styles.success} role="status" tabIndex={-1} ref={successRef}>
        <span className={styles.successTitle}>You’re on the list.</span>
        <span className={styles.successNote}>{HELP}</span>
      </p>
    );
  }

  const busy = status === "submitting";
  const invalid = status === "error";

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-busy={busy}>
      <label className={styles.srOnly} htmlFor={inputId}>
        Email
      </label>
      <div className={styles.control}>
        <input
          className={styles.input}
          id={inputId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (invalid) {
              setError("");
              setStatus("idle");
            }
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? undefined : helpId}
          disabled={busy}
          required
        />
        <button className={styles.button} type="submit" disabled={busy}>
          {busy ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {invalid ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        <p className={styles.help} id={helpId}>
          {HELP}
        </p>
      )}
    </form>
  );
}
