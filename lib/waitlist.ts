export const WAITLIST_NOTIFY_EMAIL = "msaenzcor@gmail.com";

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type RecordResult = { ok: true } | { ok: false };

async function recordInKv(email: string): Promise<boolean> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return false;
  const res = await fetch(`${url.replace(/\/$/, "")}/sadd/todero-waitlist/${encodeURIComponent(email)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function notifyInbox(email: string): Promise<boolean> {
  const dest = process.env.WAITLIST_NOTIFY_EMAIL || WAITLIST_NOTIFY_EMAIL;
  const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(dest)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email,
      _subject: "Todero waitlist",
      _template: "box",
      _captcha: "false",
      message: `${email} joined the Todero waitlist.`,
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json().catch(() => null)) as { success?: boolean | string } | null;
  if (!data) return false;
  return data.success === true || data.success === "true";
}

async function recordLocal(email: string): Promise<boolean> {
  if (process.env.VERCEL) return false;
  const { writeFile, readFile, mkdir } = await import("fs/promises");
  const { dirname } = await import("path");
  const file = process.env.WAITLIST_FILE || "/tmp/todero-waitlist.json";
  await mkdir(dirname(file), { recursive: true });
  let list: string[] = [];
  try {
    list = JSON.parse(await readFile(file, "utf8")) as string[];
  } catch {
    list = [];
  }
  if (!list.includes(email)) list.push(email);
  await writeFile(file, `${JSON.stringify(list, null, 2)}\n`, "utf8");
  return true;
}

export async function recordWaitlistEmail(raw: string): Promise<RecordResult> {
  const email = raw.trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false };
  const kv = await recordInKv(email).catch(() => false);
  const mail = await notifyInbox(email).catch(() => false);
  const local = await recordLocal(email).catch(() => false);
  if (kv || mail || local) return { ok: true };
  return { ok: false };
}
