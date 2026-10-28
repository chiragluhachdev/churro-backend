import { sendBrevoEmail } from "./brevo.js";
import { env } from "./env.js";

interface AiPassEmailInput {
  to: string;
  name: string;
  passName: string;
  passUntil: Date;
  invoiceNumber: string;
  seller: { companyName: string; email: string; phone: string };
  invoicePdf?: { filename: string; content: Buffer };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Sends the "your pass is active" email with the tax invoice attached. Never throws. */
export async function sendAiPassEmail(input: AiPassEmailInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { name, passName, passUntil, invoiceNumber, seller } = input;
  const firstName = name.trim().split(/\s+/)[0] || "there";
  const until = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" }).format(passUntil);
  const appLink = `${env.appUrl.replace(/\/$/, "")}/calculator`;
  const contact = [seller.email, seller.phone].filter(Boolean).join(" · ") || "us";
  const subject = `Your ${passName} is active`;

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F9F6F2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="background:#F9F6F2;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#F9F6F2;">
        <tr><td style="padding-bottom:24px;">
          <span style="font-size:20px;font-weight:600;color:#163B29;">Churro AI</span>
          <span style="font-size:12px;color:#6F6A60;"> by ${escapeHtml(seller.companyName)}</span>
        </td></tr>
        <tr><td style="background:#163B29;border-radius:16px 16px 0 0;padding:28px 28px 20px;">
          <p style="margin:0;color:#F9F6F2;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;">Payment confirmed</p>
          <h1 style="margin:8px 0 0;color:#F9F6F2;font-size:24px;font-weight:600;">${escapeHtml(passName)}</h1>
        </td></tr>
        <tr><td style="background:#FFFFFF;padding:24px 28px;">
          <p style="margin:0 0 14px;color:#1B2A20;font-size:15px;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 18px;color:#1B2A20;font-size:15px;line-height:1.6;">
            Thanks for joining Churro AI. Your pass is active until <strong>${escapeHtml(until)}</strong>. Sign in with this email address any time to use your tools.
          </p>
          <p style="margin:0 0 18px;">
            <a href="${escapeHtml(appLink)}" style="display:inline-block;background:#294B32;color:#F9F6F2;font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:999px;">Open Recipe Calculator &rarr;</a>
          </p>
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

Thanks for joining Churro AI. Your ${passName} is active until ${until}. Sign in with this email address any time to use your tools:
${appLink}

Your tax invoice${invoiceNumber ? ` (${invoiceNumber})` : ""} is attached to this email as a PDF.

Questions? Reach us at ${contact}.`;

  return sendBrevoEmail({ to: { email: input.to, name }, subject, html, text, attachment: input.invoicePdf });
}
