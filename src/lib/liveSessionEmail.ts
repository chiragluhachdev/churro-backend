import { sendBrevoEmail } from "./brevo.js";

interface LiveSessionEmailInput {
  to: string;
  name: string;
  title: string;
  description: string;
  link: string;
  scheduledAt: Date;
  seller: { companyName: string; email: string; phone: string };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Every announcement goes out in IST, regardless of what timezone the server runs in. */
function formatWhen(date: Date): { day: string; time: string } {
  const day = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return { day, time: `${time} IST` };
}

function buildEmail(input: LiveSessionEmailInput): { subject: string; html: string; text: string } {
  const { name, title, description, link, scheduledAt, seller } = input;
  const firstName = name.trim().split(/\s+/)[0] || "there";
  const { day, time } = formatWhen(scheduledAt);
  const subject = `Live session: ${title} — ${day}`;
  const contact = [seller.email, seller.phone].filter(Boolean).join(" · ") || "us";

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F9F6F2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="background:#F9F6F2;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#F9F6F2;">
        <tr><td style="padding-bottom:24px;">
          <span style="font-size:20px;font-weight:600;color:#163B29;">${escapeHtml(seller.companyName)}</span>
        </td></tr>
        <tr><td style="background:#163B29;border-radius:16px 16px 0 0;padding:28px 28px 20px;">
          <p style="margin:0;color:#F9F6F2;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;">Live session</p>
          <h1 style="margin:8px 0 0;color:#F9F6F2;font-size:24px;font-weight:600;">${escapeHtml(title)}</h1>
        </td></tr>
        <tr><td style="background:#FFFFFF;padding:24px 28px;">
          <p style="margin:0 0 14px;color:#1B2A20;font-size:15px;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 18px;color:#1B2A20;font-size:15px;line-height:1.6;">
            We're hosting a live session and wanted you to be there.${description ? ` ${escapeHtml(description)}` : ""}
          </p>
          <div style="margin:0 0 18px;padding:18px 20px;background:#F9F6F2;border-radius:12px;">
            <p style="margin:0 0 6px;color:#1B2A20;font-size:14px;"><strong>${escapeHtml(day)}</strong></p>
            <p style="margin:0 0 14px;color:#1B2A20;font-size:14px;">${escapeHtml(time)}</p>
            <a href="${escapeHtml(link)}" style="display:inline-block;background:#294B32;color:#F9F6F2;font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:999px;">Join the session &rarr;</a>
          </div>
          <p style="margin:0;color:#6F6A60;font-size:13px;line-height:1.6;">
            Save the link above — we'll see you there!
          </p>
        </td></tr>
        <tr><td style="background:#FFFFFF;border-radius:0 0 16px 16px;padding:18px 28px;border-top:1px solid #E7DFD1;">
          <p style="margin:0;color:#6F6A60;font-size:12px;">Questions? Reach us at ${escapeHtml(contact)}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${firstName},

We're hosting a live session and wanted you to be there.${description ? ` ${description}` : ""}

${day}
${time}

Join here: ${link}

Questions? Reach us at ${contact}.`;

  return { subject, html, text };
}

/** Sends one live-session invite. Never throws — the caller tallies ok/failed across the whole list. */
export async function sendLiveSessionEmail(
  input: LiveSessionEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { subject, html, text } = buildEmail(input);
  return sendBrevoEmail({ to: { email: input.to, name: input.name }, subject, html, text });
}
