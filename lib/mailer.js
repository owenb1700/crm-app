import nodemailer from "nodemailer";

// The one place that actually talks to Gmail's SMTP relay -- both
// /api/send-email and the digest cron send through this so there's only
// one transport to configure/debug.
export async function sendRawEmail(to, subject, html) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error("Email sending is not configured (GMAIL_USER/GMAIL_APP_PASSWORD missing)");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });

  await transporter.sendMail({
    from: `CRM Updates <${GMAIL_USER}>`,
    to,
    subject,
    html
  });
}
