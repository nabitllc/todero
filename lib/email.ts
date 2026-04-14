/**
 * lib/email.ts — Transactional email utility (KEM-1451)
 *
 * Sends announcement emails via Resend. Batches large recipient
 * lists to cap at BATCH_SIZE per API call. Logs failures per-recipient
 * without throwing, so a partial failure never blocks the caller.
 *
 * Env required: RESEND_API_KEY
 * Env optional: RESEND_FROM_DOMAIN (defaults to "kemuni.app")
 */

import { Resend } from 'resend'

const BATCH_SIZE = 50
const FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN ?? 'kemuni.app'

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not configured — email sends are no-ops')
    return null
  }
  return new Resend(apiKey)
}

// ── HTML template ──────────────────────────────────────────────────────────────
// Uses table-based layout + inline styles for maximum client compatibility
// (tested against Gmail, Outlook 2016+, Apple Mail).
function buildAnnouncementHtml(opts: {
  subject: string
  body: string
  communityName: string
}): string {
  const { subject, body, communityName } = opts

  // Escape minimal HTML entities to prevent XSS in body text
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!-- Card -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;
                      box-shadow:0 1px 3px rgba(0,0,0,0.12);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1e293b;border-radius:8px 8px 0 0;padding:24px 32px;">
              <p style="margin:0;color:#94a3b8;font-size:12px;text-transform:uppercase;
                        letter-spacing:0.1em;">Announcement from</p>
              <p style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700;">
                ${escape(communityName)}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a;
                         line-height:1.3;">
                ${escape(subject)}
              </h1>
              <div style="font-size:15px;line-height:1.7;color:#334155;">
                ${escape(body)}
              </div>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;">
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;color:#64748b;font-size:12px;line-height:1.6;">
              <p style="margin:0;">
                You received this email because you are a member of
                <strong>${escape(communityName)}</strong>.
                This message was sent via <strong>Kemuni</strong>, a community management platform.
              </p>
              <p style="margin:8px 0 0;">
                If you believe you received this in error, please contact your community manager.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AnnouncementEmailPayload {
  /** Announcement subject line */
  subject: string
  /** Plain-text or light-HTML body */
  body: string
  /** Community display name — used in From header and footer */
  communityName: string
  /** List of recipient email addresses */
  recipients: string[]
}

export interface EmailSendResult {
  sent: number
  failed: number
  errors: Array<{ email: string; error: string }>
}

// ── Core send function ─────────────────────────────────────────────────────────

/**
 * Sends announcement emails to all recipients.
 * - Batches in groups of BATCH_SIZE (50) to respect Resend rate limits.
 * - Logs individual failures without throwing.
 * - Returns a summary of sent/failed counts.
 */
export async function sendAnnouncementEmails(
  payload: AnnouncementEmailPayload
): Promise<EmailSendResult> {
  const { subject, body, communityName, recipients } = payload

  const result: EmailSendResult = { sent: 0, failed: 0, errors: [] }

  if (recipients.length === 0) {
    return result
  }

  const client = getResendClient()
  if (!client) {
    // No API key — treat all as failed (dev/CI no-op)
    result.failed = recipients.length
    result.errors = recipients.map((email) => ({
      email,
      error: 'RESEND_API_KEY not configured',
    }))
    return result
  }

  const html = buildAnnouncementHtml({ subject, body, communityName })
  const fromAddress = `${communityName} via Kemuni <announcements@${FROM_DOMAIN}>`

  // Split into batches of 50
  const batches: string[][] = []
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    batches.push(recipients.slice(i, i + BATCH_SIZE))
  }

  for (const batch of batches) {
    // Send each email in the batch concurrently; log failures individually
    const sends = batch.map(async (to) => {
      try {
        const { error } = await client.emails.send({
          from: fromAddress,
          to,
          subject,
          html,
        })
        if (error) {
          console.error(`[email] failed to send to ${to}:`, error.message)
          result.failed++
          result.errors.push({ email: to, error: error.message })
        } else {
          result.sent++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[email] exception sending to ${to}:`, msg)
        result.failed++
        result.errors.push({ email: to, error: msg })
      }
    })

    await Promise.all(sends)
  }

  console.log(
    `[email] announcement "${subject}" — sent: ${result.sent}, failed: ${result.failed}`
  )

  return result
}
