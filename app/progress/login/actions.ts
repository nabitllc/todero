"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, issueSession, progressEnv, safeEqual } from "../../../lib/progress/session";

/*
  Five wrong tries from one address → ten minutes of 429. In-memory: one
  user, one page; a cold lambda simply forgets, which is fine.
*/
const attempts = new Map<string, { count: number; until: number }>();
const LIMIT = 5;
const LOCK_MS = 10 * 60 * 1000;

export type LoginState = { error?: "wrong" | "locked" | "unconfigured" };

function clientKey(): string {
  const h = headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const env = progressEnv();
  if (!env) return { error: "unconfigured" };
  const key = clientKey();
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.until > now) return { error: "locked" };

  const given = String(formData.get("password") ?? "");
  if (!safeEqual(given, env.password)) {
    const count = (record && record.until > now - LOCK_MS ? record.count : 0) + 1;
    attempts.set(key, { count, until: count >= LIMIT ? now + LOCK_MS : now });
    return { error: count >= LIMIT ? "locked" : "wrong" };
  }
  attempts.delete(key);
  const session = await issueSession(env.secret);
  cookies().set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/progress",
    expires: session.expires,
  });
  redirect("/progress");
}

export async function logout(): Promise<void> {
  cookies().set(SESSION_COOKIE, "", { httpOnly: true, path: "/progress", expires: new Date(0) });
  redirect("/progress/login");
}
