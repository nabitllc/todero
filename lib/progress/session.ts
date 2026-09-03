/*
  One shared password, one signed cookie. Edge-safe (Web Crypto only) so the
  middleware can verify without Node APIs. The secret and password live in
  Vercel env; nothing here ever logs them.
*/
export const SESSION_COOKIE = "progress_session";
export const SESSION_DAYS = 30;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Constant-time string compare; never short-circuits on the first mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function issueSession(secret: string, now = Date.now()): Promise<{ value: string; expires: Date }> {
  const expires = new Date(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const exp = String(expires.getTime());
  return { value: `${exp}.${await hmac(secret, exp)}`, expires };
}

export async function verifySession(secret: string, value: string | undefined, now = Date.now()): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, await hmac(secret, exp));
}

export function progressEnv(): { password: string; secret: string; token: string } | null {
  const password = process.env.PROGRESS_PASSWORD;
  const secret = process.env.PROGRESS_SECRET;
  const token = process.env.GITHUB_TOKEN;
  if (!password || !secret || !token) return null;
  return { password, secret, token };
}
