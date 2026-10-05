import nodemailer from "nodemailer";
import { countSend, quotaWarning } from "./mailQuota";

// The one place that actually talks to Gmail's SMTP relay -- both
// /api/send-email and the digest cron send through this so there's only
// one transport to configure/debug.
// `countsTowardQuota` is off for the warning itself. Counting the mail
// that says we are near the ceiling would be a fine way to raise it again
// on the next send, and again after that.
export async function sendRawEmail(to, subject, html, { countsTowardQuota = true } = {}) {
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

  // Counted after the send, so a message that never left doesn't eat the
  // day's allowance.
  if (countsTowardQuota) {
    const { total, crossed } = await countSend(to);
    if (crossed) {
      // Imported here rather than at the top: adminAlert sends mail
      // through this same function, and the two importing each other at
      // load time is a cycle.
      const { alertAdmins } = await import("./adminAlert.js");
      await alertAdmins({
        area: "Email sending limit",
        message: quotaWarning(total),
        detail: "Counted across digests, alert emails, login codes and password resets -- everything goes through the one Gmail relay. The count resets at midnight UTC."
      });
    }
  }
}
