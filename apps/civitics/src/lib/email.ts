/**
 * Resend email helper — REST API (no SDK dep required).
 *
 * Usage:
 *   await sendEmail({ to: "user@x.com", subject: "…", html: "<p>…</p>" });
 *
 * Required env: RESEND_API_KEY, RESEND_FROM (e.g. "Civitics <notify@civitics.com>")
 * If RESEND_API_KEY is unset, the call is a no-op returning { sent: false, reason }.
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM"];

  if (!key || !from) {
    return { sent: false, reason: "RESEND_API_KEY or RESEND_FROM not configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { sent: false, reason: `Resend HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = (await res.json()) as { id?: string };
    return { sent: true, id: data.id ?? "" };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "unknown email error",
    };
  }
}

/**
 * Wrap a notification payload in a minimal branded HTML shell.
 * Kept inline so we don't pull in a template engine.
 */
export function renderNotificationEmail(args: {
  title: string;
  body?: string | null;
  link?: string | null;
  siteUrl: string;
}): string {
  const { title, body, link, siteUrl } = args;
  const cta = link
    ? `<p><a href="${siteUrl}${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:500">View on Civitics</a></p>`
    : "";
  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
  <div style="border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:16px">
    <strong style="color:#4f46e5">Civitics</strong>
  </div>
  <h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(title)}</h2>
  ${body ? `<p style="color:#374151;line-height:1.5">${escapeHtml(body)}</p>` : ""}
  ${cta}
  <p style="color:#9ca3af;font-size:12px;margin-top:32px;border-top:1px solid #f3f4f6;padding-top:16px">
    You're receiving this because you follow this entity on Civitics.
    Manage your follows in your <a href="${siteUrl}/dashboard/notifications" style="color:#6366f1">notifications settings</a>.
  </p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
