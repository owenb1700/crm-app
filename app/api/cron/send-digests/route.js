import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { sendRawEmail } from "../../../../lib/mailer";
import { renderEmail } from "../../../../lib/emailTemplate";
import { generateIncidentCode } from "../../../../lib/adminAlert";

const BASE_URL = "https://crm-app-coral-five.vercel.app";

const formatDate = (date) => {
  if (!date) return "";
  if (date?.seconds) return new Date(date.seconds * 1000).toISOString().split("T")[0];
  return date.slice ? date.slice(0, 10) : date;
};

// Every user's own list of {dayOfWeek, daysAhead, includeOverdue} rules,
// same shape the User Settings UI writes -- with the same one-time
// carry-forward the client does for anyone who's never touched this
// setting since the digestSchedules rework (so they keep getting the old
// fixed Sunday/Wednesday digest by default instead of silently getting
// nothing).
function schedulesFor(profile) {
  if (profile.digestSchedules) return profile.digestSchedules;
  const carried = [];
  if (profile.notifySundayDigest !== false) carried.push({ dayOfWeek: 0, daysAhead: 7, includeOverdue: true });
  if (profile.notifyWednesdayDigest !== false) carried.push({ dayOfWeek: 3, daysAhead: 5, includeOverdue: true });
  return carried;
}

// Same layout as the "Send Test Digest Now" button, generalized to each
// schedule's own daysAhead/includeOverdue instead of a fixed 7 days.
// Reminder dates are plain "YYYY-MM-DD" strings in the user's own day, so
// they're compared as strings against Central time's calendar date --
// not as Date objects, which would parse them as UTC midnight and put a
// reminder due today on the wrong side of "now".
const escapeHtml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const centralDateKey = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

function buildDigestHtml({ customers, pipelineEntries, reminders, uid, daysAhead, includeOverdue }) {
  const now = new Date();
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + daysAhead);

  const mine = customers.filter(c => c.ownerId === uid && c.category !== "Project Closed");
  const dueThisWeek = mine
    .filter(c => c.nextCheckIn && new Date(c.nextCheckIn) >= now && new Date(c.nextCheckIn) <= windowEnd)
    .sort((a, b) => new Date(a.nextCheckIn) - new Date(b.nextCheckIn));
  const overdue = includeOverdue
    ? mine
        .filter(c => c.nextCheckIn && new Date(c.nextCheckIn) < now)
        .sort((a, b) => new Date(a.nextCheckIn) - new Date(b.nextCheckIn))
    : [];

  const pipelineDue = pipelineEntries
    .filter(p => p.outcome === "Won" && p.nextCheckIn && (p.projectPointPersonId || p.salespersonId || p.ownerId) === uid)
    .filter(p => new Date(p.nextCheckIn) >= now && new Date(p.nextCheckIn) <= windowEnd)
    .sort((a, b) => new Date(a.nextCheckIn) - new Date(b.nextCheckIn));

  const row = (name, company, date, link) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
        <a href="${link}" style="color:#2563eb;text-decoration:none;font-weight:600;">${name}</a>
        ${company ? `<div style="color:#6b7280;font-size:13px;">${company}</div>` : ""}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151;white-space:nowrap;">${formatDate(date)}</td>
    </tr>`;

  const section = (title, items, getRow) => (items.length ? `
    <h3 style="margin:24px 0 8px;font-size:15px;color:#111827;">${title} (${items.length})</h3>
    <table style="width:100%;border-collapse:collapse;">${items.map(getRow).join("")}</table>
  ` : "");

  const todayKey = centralDateKey(now);
  const windowEndKey = centralDateKey(windowEnd);
  const myReminders = reminders
    .filter(r => r.userId === uid && r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const remindersDue = myReminders.filter(r => r.date >= todayKey && r.date <= windowEndKey);
  const remindersOverdue = includeOverdue ? myReminders.filter(r => r.date < todayKey) : [];
  // Reminders open on the dashboard (there's no per-reminder page), and
  // their notes show under the subject the way a company does for a project.
  // Subject and notes are free text anyone typed, so escape them before
  // they go into the email's HTML.
  const reminderRow = (r) => row(escapeHtml(r.subject), escapeHtml(r.notes), r.date, `${BASE_URL}/dashboard`);

  const total = dueThisWeek.length + overdue.length + pipelineDue.length + remindersDue.length + remindersOverdue.length;

  const bodyHtml = `
    ${section(`Reminders Due Within ${daysAhead} Day${daysAhead === 1 ? "" : "s"}`, remindersDue, reminderRow)}
    ${section("Overdue Reminders", remindersOverdue, reminderRow)}
    ${section(`Due Within ${daysAhead} Day${daysAhead === 1 ? "" : "s"}`, dueThisWeek, c => row(c.projectName || c.company, c.company, c.nextCheckIn, `${BASE_URL}/dashboard/project/${c.id}`))}
    ${section("Overdue", overdue, c => row(c.projectName || c.company, c.company, c.nextCheckIn, `${BASE_URL}/dashboard/project/${c.id}`))}
    ${section("Pipeline Follow-Ups Coming Up", pipelineDue, p => row(p.title, p.company, p.nextCheckIn, `${BASE_URL}/dashboard/pipeline/${p.id}`))}
    ${total === 0 ? '<p style="color:#6b7280;">Nothing due right now.</p>' : ""}
  `;

  return {
    total,
    html: renderEmail({
      heading: "Your Upcoming Tasks",
      intro: "Your scheduled digest, sent automatically.",
      bodyHtml
    })
  };
}

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
