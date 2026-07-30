import nodemailer from "nodemailer";

export async function POST(req) {
  const { to, subject, html } = await req.json();

  if (!to || !subject || !html) {
    return Response.json({ error: "Missing to, subject, or html" }, { status: 400 });
  }

  const { SES_SMTP_HOST, SES_SMTP_PORT, SES_SMTP_USER, SES_SMTP_PASS, SES_FROM_EMAIL } = process.env;
  if (!SES_SMTP_HOST || !SES_SMTP_USER || !SES_SMTP_PASS || !SES_FROM_EMAIL) {
    return Response.json({ error: "Email sending is not configured" }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: SES_SMTP_HOST,
    port: Number(SES_SMTP_PORT) || 587,
    secure: false,
    auth: { user: SES_SMTP_USER, pass: SES_SMTP_PASS }
  });

  try {
    await transporter.sendMail({
      from: `CRM <${SES_FROM_EMAIL}>`,
      to,
      subject,
      html
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: `Failed to send email: ${err.message}` }, { status: 502 });
  }
}
