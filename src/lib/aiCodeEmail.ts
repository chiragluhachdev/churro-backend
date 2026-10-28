import { sendBrevoEmail } from "./brevo.js";

/**
 * Sends a Churro AI sign-in code. The code is in the subject too, so it shows
 * in the inbox preview — and in the console when Brevo isn't configured
 * (dummy mode logs the subject), which keeps local sign-in working.
 */
export async function sendAiCodeEmail(to: string, code: string, minutes: number) {
  const subject = `${code} is your Churro AI sign-in code`;

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F9F6F2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="background:#F9F6F2;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#FFFFFF;border-radius:16px;">
        <tr><td style="padding:28px 28px 8px;">
          <span style="font-size:20px;font-weight:600;color:#163B29;">Churro AI</span>
        </td></tr>
        <tr><td style="padding:8px 28px 28px;">
          <p style="margin:0 0 16px;color:#1B2A20;font-size:15px;line-height:1.6;">Here&rsquo;s your sign-in code:</p>
          <p style="margin:0 0 16px;color:#163B29;font-size:32px;font-weight:700;letter-spacing:0.3em;">${code}</p>
          <p style="margin:0;color:#6F6A60;font-size:13px;line-height:1.6;">
            It works for ${minutes} minutes. If you didn&rsquo;t ask for it, you can ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Your Churro AI sign-in code is ${code}.

It works for ${minutes} minutes. If you didn't ask for it, you can ignore this email.`;

  return sendBrevoEmail({ to: { email: to }, subject, html, text });
}
