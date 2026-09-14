import { env } from "./env.js";

export type EmailProvider = "dummy" | "brevo";

/** Same convention as the chat widget's GROQ_API_KEY: present the key, get the real thing. */
export function activeEmailProvider(): EmailProvider {
  return process.env.BREVO_API_KEY ? "brevo" : "dummy";
}

/** Parses "Name <email@x.com>" (or a bare email) into Brevo's {name, email} shape. */
function parseSender(raw: string): { name: string; email: string } {
  const match = raw.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  if (match) return { name: match[1] || "Churro Academy", email: match[2].trim() };
  return { name: "Churro Academy", email: raw.trim() };
}

interface CourseAccessEmailInput {
  to: string;
  buyerName: string;
  courseTitle: string;
  shortDescription: string;
  invoiceNumber: string;
  invoiceUrl: string;
  /** Only lessons a link has been added to show one — everything else reads "coming soon". */
  sections: { title: string; lessons: { title: string; videoUrl?: string }[] }[];
  seller: { companyName: string; email: string; phone: string };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function buildEmail(input: CourseAccessEmailInput): { subject: string; html: string; text: string } {
  const { buyerName, courseTitle, shortDescription, invoiceNumber, invoiceUrl, sections, seller } = input;
  const firstName = buyerName.trim().split(/\s+/)[0] || "there";
  const subject = `You're enrolled — ${courseTitle}`;
  const contact = [seller.email, seller.phone].filter(Boolean).join(" · ") || "us";

  const lessonRowsHtml = sections
    .map((section) => {
      const rows = section.lessons
        .map((lesson) => {
          const link = lesson.videoUrl?.trim();
          const action = link
            ? `<a href="${escapeHtml(link)}" style="color:#294B32;font-weight:600;text-decoration:none;">Watch &rarr;</a>`
            : `<span style="color:#9a948a;">Coming soon</span>`;
          return `<tr>
            <td style="padding:10px 0;border-bottom:1px solid #E7DFD1;color:#1B2A20;font-size:14px;">${escapeHtml(lesson.title)}</td>
            <td style="padding:10px 0;border-bottom:1px solid #E7DFD1;text-align:right;font-size:14px;white-space:nowrap;">${action}</td>
          </tr>`;
        })
        .join("");
      return `<tr><td colspan="2" style="padding:18px 0 6px;color:#6F6A60;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">${escapeHtml(section.title)}</td></tr>${rows}`;
    })
    .join("");

  const lessonRowsText = sections
    .map(
      (section) =>
        `${section.title}\n` +
        section.lessons
          .map((l) => `  - ${l.title}: ${l.videoUrl?.trim() || "coming soon"}`)
          .join("\n"),
    )
    .join("\n\n");

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
            Thanks for enrolling in <strong>${escapeHtml(courseTitle)}</strong>. ${escapeHtml(shortDescription)}
          </p>
          <p style="margin:0 0 18px;color:#1B2A20;font-size:15px;line-height:1.6;">Here are your lesson videos:</p>
          <table role="presentation" width="100%" style="border-collapse:collapse;">
            ${lessonRowsHtml}
          </table>
          <p style="margin:22px 0 0;color:#6F6A60;font-size:13px;line-height:1.6;">
            We'll also send these on WhatsApp as a backup. Save this email — you can always find your links here.
          </p>
          <p style="margin:18px 0 0;">
            <a href="${escapeHtml(invoiceUrl)}" style="color:#294B32;font-size:14px;font-weight:600;text-decoration:none;">View your invoice (${escapeHtml(invoiceNumber)}) &rarr;</a>
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

Thanks for enrolling in ${courseTitle}. ${shortDescription}

Your lesson videos:

${lessonRowsText}

We'll also send these on WhatsApp as a backup. Save this email — you can always find your links here.

Invoice ${invoiceNumber}: ${invoiceUrl}

Questions? Reach us at ${contact}.`;

  return { subject, html, text };
}

/**
 * Sends the "you're enrolled" email with whatever lesson video links the
 * admin has set so far. Never throws — a delivery failure must not undo a
 * successful payment; callers log the returned error themselves if they want.
 */
export async function sendCourseAccessEmail(
  input: CourseAccessEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { subject, html, text } = buildEmail(input);
  const provider = activeEmailProvider();

  if (provider === "dummy") {
    console.log(`[email:dummy] Would send "${subject}" to ${input.to}. Set BREVO_API_KEY to actually send.`);
    return { ok: true };
  }

  try {
    const sender = parseSender(process.env.EMAIL_FROM || "Churro Academy <no-reply@churroacademyglobal.com>");
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": process.env.BREVO_API_KEY!,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: input.to, name: input.buyerName || undefined }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // Almost always means EMAIL_FROM isn't a sender verified in the Brevo
      // account yet — Brevo has no sandbox sender the way some providers do.
      return { ok: false, error: `brevo ${response.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

/** Where links in the email point back to — the deployed frontend. */
export function appUrl(): string {
  return env.appUrl;
}
