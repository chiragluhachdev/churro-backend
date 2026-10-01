import { activeEmailProvider, sendBrevoEmail } from "./brevo.js";

export { activeEmailProvider };

interface CourseAccessEmailInput {
  to: string;
  buyerName: string;
  courseTitle: string;
  shortDescription: string;
  invoiceNumber: string;
  /** Empty until the admin adds one — the email then says the videos are on their way. */
  driveLink: string;
  drivePassword: string;
  seller: { companyName: string; email: string; phone: string };
  /** The tax invoice as a real file, not a link — attached directly to the email. */
  invoicePdf?: { filename: string; content: Buffer };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function buildEmail(input: CourseAccessEmailInput): { subject: string; html: string; text: string } {
  const { buyerName, courseTitle, shortDescription, invoiceNumber, driveLink, drivePassword, seller } = input;
  const firstName = buyerName.trim().split(/\s+/)[0] || "there";
  const subject = `You're enrolled — ${courseTitle}`;
  const contact = [seller.email, seller.phone].filter(Boolean).join(" · ") || "us";
  const hasLink = Boolean(driveLink.trim());

  const videosHtml = hasLink
    ? `<div style="margin:0 0 18px;padding:18px 20px;background:#F9F6F2;border-radius:12px;">
        <p style="margin:0 0 12px;color:#1B2A20;font-size:14px;font-weight:600;">Your course videos</p>
        <a href="${escapeHtml(driveLink.trim())}" style="display:inline-block;background:#294B32;color:#F9F6F2;font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:999px;">Open on Google Drive &rarr;</a>
        ${
          drivePassword.trim()
            ? `<p style="margin:14px 0 0;color:#1B2A20;font-size:13px;">Password: <span style="font-family:monospace;background:#FFFFFF;border:1px solid #E7DFD1;border-radius:6px;padding:2px 8px;">${escapeHtml(drivePassword.trim())}</span></p>`
            : ""
        }
      </div>`
    : `<p style="margin:0 0 18px;color:#6F6A60;font-size:14px;line-height:1.6;">
        Your course videos are being finalised and we'll share the link here shortly.
      </p>`;

  const videosText = hasLink
    ? `Your course videos: ${driveLink.trim()}` + (drivePassword.trim() ? `\nPassword: ${drivePassword.trim()}` : "")
    : "Your course videos are being finalised and we'll share the link here shortly.";

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
          <p style="margin:0;color:#F9F6F2;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;">Payment confirmed</p>
          <h1 style="margin:8px 0 0;color:#F9F6F2;font-size:24px;font-weight:600;">${escapeHtml(courseTitle)}</h1>
        </td></tr>
        <tr><td style="background:#FFFFFF;padding:24px 28px;">
          <p style="margin:0 0 14px;color:#1B2A20;font-size:15px;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 18px;color:#1B2A20;font-size:15px;line-height:1.6;">
            Congratulations, and thanks for enrolling in <strong>${escapeHtml(courseTitle)}</strong>! ${escapeHtml(shortDescription)}
          </p>
          ${videosHtml}
          <p style="margin:0;color:#6F6A60;font-size:13px;line-height:1.6;">
            Your tax invoice${invoiceNumber ? ` (${escapeHtml(invoiceNumber)})` : ""} is attached to this email as a PDF.
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

Congratulations, and thanks for enrolling in ${courseTitle}! ${shortDescription}

${videosText}

Your tax invoice${invoiceNumber ? ` (${invoiceNumber})` : ""} is attached to this email as a PDF.

Questions? Reach us at ${contact}.`;

  return { subject, html, text };
}

/**
 * Sends the "you're enrolled" email with whatever Drive link the admin has
 * set so far. Never throws — a delivery failure must not undo a successful
 * payment; callers log the returned error themselves if they want.
 */
export async function sendCourseAccessEmail(
  input: CourseAccessEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { subject, html, text } = buildEmail(input);
  return sendBrevoEmail({
    to: { email: input.to, name: input.buyerName },
    subject,
    html,
    text,
    attachment: input.invoicePdf,
  });
}
