/**
 * Thin wrapper over Brevo's transactional email API — every email this app
 * sends (enrollment receipts, live-session announcements) goes through here.
 *
 *   BREVO_API_KEY unset  ->  dummy mode: logs instead of sending.
 *   BREVO_API_KEY set    ->  real send, from BREVO_SENDER_EMAIL (must be a
 *                            verified sender in the Brevo account).
 */
export type EmailProvider = "dummy" | "brevo";

export function activeEmailProvider(): EmailProvider {
  return process.env.BREVO_API_KEY ? "brevo" : "dummy";
}

export interface BrevoSendInput {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
  attachment?: { filename: string; content: Buffer };
}

export async function sendBrevoEmail(input: BrevoSendInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (activeEmailProvider() === "dummy") {
    console.log(
      `[email:dummy] Would send "${input.subject}" to ${input.to.email}` +
        (input.attachment ? ` with ${input.attachment.filename} attached` : "") +
        `. Set BREVO_API_KEY to actually send.`,
    );
    return { ok: true };
  }

  try {
    const sender = {
      name: process.env.BREVO_SENDER_NAME || "Churro Academy",
      email: process.env.BREVO_SENDER_EMAIL || "",
    };
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": process.env.BREVO_API_KEY!,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: input.to.email, name: input.to.name || undefined }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
        ...(input.attachment && {
          attachment: [{ name: input.attachment.filename, content: input.attachment.content.toString("base64") }],
        }),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // Almost always means BREVO_SENDER_EMAIL isn't verified in the Brevo
      // account yet, or the account's IP allowlist is blocking this server —
      // Brevo has no sandbox sender the way some providers do.
      return { ok: false, error: `brevo ${response.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}
