"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";
import styles from "../progress.module.css";

const MESSAGES: Record<NonNullable<LoginState["error"]>, string> = {
  wrong: "That’s not it.",
  locked: "Too many tries. Ten minutes.",
  unconfigured: "Progress isn’t configured on this deployment.",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className={styles.button} type="submit" disabled={pending}>
      {pending ? "Checking…" : "Open"}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useFormState<LoginState, FormData>(login, {});
  const input = useRef<HTMLInputElement>(null);

  // A wrong guess leaves an empty, focused field — not the wrong text.
  useEffect(() => {
    if (state.error && input.current) {
      input.current.value = "";
      input.current.focus();
    }
  }, [state]);

  return (
    <form className={styles.form} action={action}>
      <label className={styles.label} htmlFor="progress-password">
        Password
      </label>
      <div className={styles.control}>
        <input
          ref={input}
          className={styles.input}
          id="progress-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "progress-error" : undefined}
        />
        <Submit />
      </div>
      {state.error ? (
        <p className={styles.error} id="progress-error" role="alert">
          {MESSAGES[state.error]}
        </p>
      ) : null}
    </form>
  );
}
