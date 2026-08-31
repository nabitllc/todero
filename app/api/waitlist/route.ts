import { isValidEmail, recordWaitlistEmail } from "../../../lib/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { email?: unknown } = {};
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return Response.json({ error: "Enter an email address." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email : "";
  if (!isValidEmail(email)) {
    return Response.json({ error: "Enter an email address." }, { status: 400 });
  }
  const result = await recordWaitlistEmail(email);
  if (!result.ok) {
    return Response.json({ error: "Could not join the waitlist." }, { status: 503 });
  }
  return Response.json({ ok: true });
}
