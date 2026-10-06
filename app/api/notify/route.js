import { getAdminDb } from "../../../lib/firebaseAdmin";
import { sendRawEmail } from "../../../lib/mailer";
import { renderEmail } from "../../../lib/emailTemplate";
import { requireActiveUser, withinRateLimit } from "../../../lib/apiAuth";
import { wantsAlertEmail, alertEmailSubject, alertEmailHtml, emailableAlert } from "../../../lib/alertEmails";

// Emails the people an alert was just raised for.
//
// The alert itself is written under the bell by whoever caused it, and
// that is the record -- this only puts a copy in their inbox. So nothing
// here is allowed to fail loudly: an alert that doesn't get emailed is a
// smaller problem than a save that falls over because the mail server was
// slow, and the bell is right either way.
//
// Addresses are looked up here rather than sent in: the browser raising an
// alert has no business knowing everyone's email, and a client that could
// name both recipient and body would be a way to send mail as the company
// to anyone at all.
export async function POST(req) {
  const caller = await requireActiveUser(req);
  if (caller.error) return Response.json({ error: caller.error }, { status: caller.status });

  // One alert can fan out to a handful of people, so this is per-alert
  // rather than per-email.
  if (!withinRateLimit(`notify:${caller.uid}`, { limit: 60, windowMs: 60_000 })) {
    return Response.json({ error: "Too many alerts at once" }, { status: 429 });
  }

  const { userIds, type, message, link } = await req.json();
  if (!Array.isArray(userIds) || !userIds.length || !type || !message) {
    return Response.json({ error: "Missing userIds, type, or message" }, { status: 400 });
  }
  if (!emailableAlert(type)) {
    // A real alert type that simply isn't one we email -- the nightly bid
    // nudge, say. Not an error.
    return Response.json({ sent: 0, skipped: "type is not emailed" });
  }

  const db = getAdminDb();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm-app-coral-five.vercel.app";
  const subject = alertEmailSubject(type, message);
  const html = renderEmail({ bodyHtml: alertEmailHtml({ message, link, appUrl }) });

  const recipients = [...new Set(userIds.filter(Boolean))].filter(id => id !== caller.uid);
  let sent = 0;
  const failed = [];

  await Promise.all(recipients.map(async (userId) => {
    try {
      const snap = await db.collection("users").doc(userId).get();
      const user = snap.exists ? snap.data() : null;
      if (!user || user.disabled || !user.email) return;
      if (!wantsAlertEmail(user, type)) return;
      await sendRawEmail(user.email, subject, html);
      sent += 1;
    } catch {
      failed.push(userId);
    }
  }));

  return Response.json({ sent, failed: failed.length });
}
