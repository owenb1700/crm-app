import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { sendRawEmail } from "../../../../lib/mailer";
import { renderEmail } from "../../../../lib/emailTemplate";
import { buildDigestHtml, schedulesFor } from "../../../../lib/digest";
import { generateIncidentCode } from "../../../../lib/adminAlert";

// Runs daily (see vercel.json) at 4:00 AM Central. Every user's
// digestSchedules is a list of {dayOfWeek, daysAhead, includeOverdue}
// rules -- this sends one email per rule that matches TODAY, in whichever
// timezone the user actually meant ("Sunday" is Central time, not UTC).
export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const [usersSnap, customersSnap, pipelineSnap, remindersSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("customers").get(),
    db.collection("pipeline").get(),
    db.collection("reminders").get()
  ]);

  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const customers = customersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const pipelineEntries = pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const reminders = remindersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const testEmail = new URL(req.url).searchParams.get("testEmail");

  // "Sunday" in a schedule means Central time's Sunday, not UTC's --
  // matters a lot right around midnight.
  const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const centralWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(new Date());
  const todayCentral = WEEKDAY_INDEX[centralWeekday];

  const sent = [];
  const skipped = [];
  const failed = [];

  for (const user of users) {
    if (user.disabled || !user.email) continue;

    const schedules = testEmail
      ? [{ dayOfWeek: todayCentral, daysAhead: 7, includeOverdue: true }]
      : schedulesFor(user).filter(s => s.dayOfWeek === todayCentral);

    if (testEmail && user.email.toLowerCase() !== testEmail.toLowerCase()) continue;
    if (!testEmail && schedules.length === 0) continue;

    for (const schedule of schedules) {
      try {
        const { html, total } = buildDigestHtml({
          customers,
          pipelineEntries,
          reminders,
          uid: user.id,
          role: user.role,
          daysAhead: schedule.daysAhead || 7,
          includeOverdue: schedule.includeOverdue !== false
        });
        await sendRawEmail(user.email, "Your Upcoming Tasks", html);
        sent.push({ email: user.email, total });
      } catch (err) {
        failed.push({ email: user.email, error: err.message });
      }
    }
  }

  // A failure here would otherwise be completely silent -- nothing else
  // ever looks at this route's response. On a real (non-test) run, tell
  // every admin so a missed digest gets noticed the same day instead of
  // whenever someone happens to mention it.
  let alertCode = null;
  if (!testEmail && failed.length > 0) {
    alertCode = generateIncidentCode();
    const admins = users.filter(u => u.role === "admin" && u.email && !u.disabled);
    const summary = failed.map(f => `<li>${f.email}: ${f.error}</li>`).join("");
    const alertHtml = renderEmail({
      heading: "Digest Send Failures",
      bodyHtml: `
        <p style="margin:0 0 16px;font-size:13px;color:#374151;">
          Incident code <strong style="font-family:monospace;background:#f3f4f6;padding:2px 6px;border-radius:4px;">${alertCode}</strong>
          -- paste this code (or this whole email) back into Claude Code to look into it.
        </p>
        <p style="margin:0 0 12px;color:#6b7280;">${failed.length} of ${sent.length + failed.length} scheduled digest emails failed to send today.</p>
        <ul style="color:#374151;">${summary}</ul>
      `
    });
    await Promise.all(admins.map(a => sendRawEmail(a.email, `CRM Alert [${alertCode}]: Digest Send Failures`, alertHtml).catch(() => {})));
  }

  return Response.json({ ok: true, dayOfWeek: todayCentral, sent, failed, userCount: users.length, alertCode });
}
