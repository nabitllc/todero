export const WAITLIST_SEGMENT_NAME = "Todero waitlist";

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type RecordResult = { ok: true } | { ok: false; missingKey?: boolean };

type ResendJson = {
  id?: string;
  name?: string;
  message?: string;
  error?: string;
  data?: { id?: string; name?: string }[];
};

async function resendFetch(path: string, init: RequestInit = {}): Promise<{ status: number; json: ResendJson | null }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: 0, json: null };
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => null)) as ResendJson | null;
  return { status: res.status, json };
}

function isDuplicate(status: number, json: ResendJson | null): boolean {
  if (status === 409) return true;
  const msg = `${json?.message || json?.error || ""}`.toLowerCase();
  return msg.includes("already") || msg.includes("exists");
}

async function resolveSegmentId(): Promise<string | null> {
  const listed = await resendFetch("/segments");
  if (listed.status >= 200 && listed.status < 300) {
    const hit = listed.json?.data?.find((row) => row.name === WAITLIST_SEGMENT_NAME);
    if (hit?.id) return hit.id;
  }
  const created = await resendFetch("/segments", {
    method: "POST",
    body: JSON.stringify({ name: WAITLIST_SEGMENT_NAME }),
  });
  if (created.status >= 200 && created.status < 300 && created.json?.id) {
    return created.json.id;
  }
  const listedAgain = await resendFetch("/segments");
  const hit = listedAgain.json?.data?.find((row) => row.name === WAITLIST_SEGMENT_NAME);
  return hit?.id || null;
}

async function addToSegment(email: string, segmentId: string): Promise<boolean> {
  const added = await resendFetch(`/contacts/${encodeURIComponent(email)}/segments/${segmentId}`, {
    method: "POST",
  });
  if (added.status >= 200 && added.status < 300) return true;
  return isDuplicate(added.status, added.json);
}

export async function recordWaitlistEmail(raw: string): Promise<RecordResult> {
  const email = raw.trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false };
  if (!process.env.RESEND_API_KEY) return { ok: false, missingKey: true };

  const segmentId = await resolveSegmentId();
  if (!segmentId) return { ok: false };

  const created = await resendFetch("/contacts", {
    method: "POST",
    body: JSON.stringify({
      email,
      unsubscribed: false,
      segments: [{ id: segmentId }],
    }),
  });
  if (created.status >= 200 && created.status < 300) return { ok: true };
  if (!isDuplicate(created.status, created.json)) return { ok: false };

  const onSegment = await addToSegment(email, segmentId);
  return onSegment ? { ok: true } : { ok: false };
}
