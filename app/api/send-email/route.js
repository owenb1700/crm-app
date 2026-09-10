import nodemailer from "nodemailer";

// Sends via a real Gmail account's own SMTP relay (crmupdates169@gmail.com,
// authenticated with a Gmail "App Password"), not AWS SES. SES sending as
// bullocklogan.com kept getting silently dropped by the receiving mail
// server -- the domain's SPF only authorizes Microsoft 365 and DKIM was
// never set up for SES, so every SES-sent message failed DMARC and never
// arrived, even though SES itself always reported success. Gmail's own
// relay doesn't have that problem since the mail genuinely originates from
// Google's servers under this address, not a third party impersonating it.
export async function POST(req) {
  const { to, subject, html } = await req.json();

  if (!to || !subject || !html) {
    return Response.json({ error: "Missing to, subject, or html" }, { status: 400 });
  }

  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return Response.json({ error: "Email sending is not configured" }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });

  try {
    await transporter.sendMail({
      from: `CRM Updates <${GMAIL_USER}>`,
      to,
      subject,
      html
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: `Failed to send email: ${err.message}` }, { status: 502 });
  }
}
