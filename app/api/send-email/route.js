import { sendRawEmail } from "../../../lib/mailer";
import { renderEmail } from "../../../lib/emailTemplate";
import { alertAdmins } from "../../../lib/adminAlert";
import { requireActiveUser, withinRateLimit } from "../../../lib/apiAuth";

// Sends via a real Gmail account's own SMTP relay (crmupdates169@gmail.com,
// authenticated with a Gmail "App Password"), not AWS SES. SES sending as
// bullocklogan.com kept getting silently dropped by the receiving mail
// server -- the domain's SPF only authorizes Microsoft 365 and DKIM was
// never set up for SES, so every SES-sent message failed DMARC and never
// arrived, even though SES itself always reported success. Gmail's own
// relay doesn't have that problem since the mail genuinely originates from
// Google's servers under this address, not a third party impersonating it.
//
// Every caller's `html` is just the body content (a heading + whatever
// tables/paragraphs) -- this wraps it in the shared branded shell (logo,
// dark header) so every email in the app looks consistent, and alerts
// every admin (with a pasteable incident code) if the send fails instead
// of that failure only ever showing up as a JSON error nobody looks at.
export async function POST(req) {
  // Only a signed-in, active account can send mail from the company's
  // address -- an open endpoint here would be a phishing tool aimed at our
  // own domain, and could get the sending account shut down.
  const caller = await requireActiveUser(req);
  if (caller.error) {
    return Response.json({ error: caller.error }, { status: caller.status });
  }
  if (!withinRateLimit(`send-email:${caller.uid}`, { limit: 30, windowMs: 60_000 })) {
    return Response.json({ error: "Too many emails at once -- wait a minute and try again" }, { status: 429 });
  }

  const { to, subject, html } = await req.json();

  if (!to || !subject || !html) {
    return Response.json({ error: "Missing to, subject, or html" }, { status: 400 });
  }

  const fullHtml = renderEmail({ bodyHtml: html });

  try {
    await sendRawEmail(to, subject, fullHtml);
    return Response.json({ ok: true });
  } catch (err) {
    const code = await alertAdmins({
      area: "Email send",
      message: `Failed to send "${subject}" to ${to}`,
      detail: err.message
    });
    return Response.json({ error: `Failed to send email: ${err.message}`, code }, { status: 502 });
  }
}
