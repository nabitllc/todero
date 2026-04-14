/**
 * POST /api/announcements
 *
 * Email delivery endpoint for community announcements (KEM-1451).
 * Accepts a recipient list, subject, body, and community name, then
 * fans out via sendAnnouncementEmails() in batches of 50.
 *
 * This route is the integration point consumed by the full announcement
 * send flow (KEM-1447). Tier-gating and usage tracking live there;
 * this handler owns only the email delivery concern.
 *
 * Body:
 *   {
 *     subject:       string        — announcement subject line
 *     body:          string        — announcement body text
 *     communityName: string        — used in From display name + footer
 *     recipients:    string[]      — list of recipient email addresses
 *   }
 *
 * Response 200:
 *   { sent: number, failed: number, errors: Array<{email, error}> }
 * Response 400: missing required fields
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendAnnouncementEmails } from '@/lib/email'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { subject, body: announcementBody, communityName, recipients } =
    body as Record<string, unknown>

  // Validate required fields
  if (typeof subject !== 'string' || !subject.trim()) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 })
  }
  if (typeof announcementBody !== 'string' || !announcementBody.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }
  if (typeof communityName !== 'string' || !communityName.trim()) {
    return NextResponse.json({ error: 'communityName is required' }, { status: 400 })
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'recipients must be a non-empty array' }, { status: 400 })
  }

  // Filter to valid-looking email strings
  const validRecipients = (recipients as unknown[]).filter(
    (r): r is string => typeof r === 'string' && r.includes('@')
  )

  const result = await sendAnnouncementEmails({
    subject: subject.trim(),
    body: announcementBody.trim(),
    communityName: communityName.trim(),
    recipients: validRecipients,
  })

  return NextResponse.json(result)
}
