import { renderEmail } from "./emailTemplate";
import { isPipelineBidAlertFor, isWonFollowUpFor, isProjectCheckInFor } from "./alertRecipients";
import { withoutTrashed, reminderJobIsActive } from "./trash";

const BASE_URL = "https://crm-app-coral-five.vercel.app";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULT_DIGEST_SCHEDULE = { dayOfWeek: 0, daysAhead: 7, includeOverdue: true };

const formatDate = (date) => {
  if (!date) return "";
  if (date?.seconds) return new Date(date.seconds * 1000).toISOString().split("T")[0];
  return date.slice ? date.slice(0, 10) : date;
};

const escapeHtml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Reminder dates are plain "YYYY-MM-DD" strings in the user's own day, so
// they're compared as strings against Central time's calendar date -- not
// as Date objects, which would parse them as UTC midnight and put a
// reminder due today on the wrong side of "now".
const centralDateKey = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// A user's list of {dayOfWeek, daysAhead, includeOverdue} rules, as User
// Settings writes them. Anyone who has never saved that setting keeps the
// old fixed Sunday/Wednesday digests instead of silently getting nothing.
// Safe to import in the browser -- no server-only dependencies.
export function schedulesFor(profile) {
  if (profile?.digestSchedules) return profile.digestSchedules;
  const carried = [];
  if (profile?.notifySundayDigest !== false) carried.push({ dayOfWeek: 0, daysAhead: 7, includeOverdue: true });
  if (profile?.notifyWednesdayDigest !== false) carried.push({ dayOfWeek: 3, daysAhead: 5, includeOverdue: true });
  return carried;
}

// The one digest email builder -- used by the daily scheduled send and by
// "Send Test Digest Now", so a test shows exactly what the real one will.
export function buildDigestHtml({ customers: allCustomers, pipelineEntries: allPipeline, reminders: allReminders, uid, role, daysAhead, includeOverdue, intro }) {
  const customers = withoutTrashed(allCustomers);
  const pipelineEntries = withoutTrashed(allPipeline);
  // Parts aren't loaded here, so a parts-attached reminder is kept as-is
  // rather than dropped (reminderJobIsActive only checks what it's given).
  const reminders = (allReminders || []).filter(r => reminderJobIsActive(r, customers, pipelineEntries));
  const now = new Date();
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + daysAhead);

  // Active projects this person should hear about: their own, plus -- for
  // Estimating and the point person -- projects converted from won bids.
  const mine = customers.filter(c => c.category !== "Project Closed" && isProjectCheckInFor(c, uid, role));
  const dueThisWeek = mine
    .filter(c => c.nextCheckIn && new Date(c.nextCheckIn) >= now && new Date(c.nextCheckIn) <= windowEnd)
    .sort((a, b) => new Date(a.nextCheckIn) - new Date(b.nextCheckIn));
  const overdue = includeOverdue
    ? mine
        .filter(c => c.nextCheckIn && new Date(c.nextCheckIn) < now)
        .sort((a, b) => new Date(a.nextCheckIn) - new Date(b.nextCheckIn))
    : [];

  // Closed projects the owner should check in on (Project Closed outcome).
  const closedCheckIns = customers
    .filter(c => c.ownerId === uid && c.category === "Project Closed" && c.closedOutcome === "Closed" && c.nextCheckIn)
    .filter(c => {
      const key = String(c.nextCheckIn).slice(0, 10);
      return key <= centralDateKey(windowEnd) && (includeOverdue || key >= centralDateKey(now));
    })
    .sort((a, b) => String(a.nextCheckIn).localeCompare(String(b.nextCheckIn)));

  // Open pipeline entries' bid dates, for everyone on the hook for them.
  const bidDates = pipelineEntries
    .filter(p => isPipelineBidAlertFor(p, uid, role))
    .filter(p => {
      const key = String(p.bidDate).slice(0, 10);
      return key <= centralDateKey(windowEnd) && (includeOverdue || key >= centralDateKey(now));
    })
    .sort((a, b) => String(a.bidDate).localeCompare(String(b.bidDate)));

  const pipelineDue = pipelineEntries
    .filter(p => isWonFollowUpFor(p, uid, role))
    .filter(p => new Date(p.nextCheckIn) <= windowEnd && (includeOverdue || new Date(p.nextCheckIn) >= now))
    .sort((a, b) => new Date(a.nextCheckIn) - new Date(b.nextCheckIn));

  const row = (name, subtitle, date, link) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
        <a href="${link}" style="color:#2563eb;text-decoration:none;font-weight:600;">${name}</a>
        ${subtitle ? `<div style="color:#6b7280;font-size:13px;">${subtitle}</div>` : ""}
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
  // Reminders open on the dashboard (there's no per-reminder page); notes
  // show under the subject. Both are free text, so they're escaped.
  const reminderRow = (r) => row(
    escapeHtml(r.subject),
    escapeHtml(r.notes),
    r.date,
    r.projectId ? `${BASE_URL}/dashboard/project/${r.projectId}`
      : r.pipelineId ? `${BASE_URL}/dashboard/pipeline/${r.pipelineId}`
      : `${BASE_URL}/dashboard`
  );

  const total = dueThisWeek.length + overdue.length + pipelineDue.length + remindersDue.length + remindersOverdue.length + closedCheckIns.length + bidDates.length;
  const windowLabel = `${daysAhead} Day${daysAhead === 1 ? "" : "s"}`;

  const bodyHtml = `
    ${section(`Reminders Due Within ${windowLabel}`, remindersDue, reminderRow)}
    ${section("Overdue Reminders", remindersOverdue, reminderRow)}
    ${section(`Due Within ${windowLabel}`, dueThisWeek, c => row(c.projectName || c.company, c.company, c.nextCheckIn, `${BASE_URL}/dashboard/project/${c.id}`))}
    ${section("Overdue", overdue, c => row(c.projectName || c.company, c.company, c.nextCheckIn, `${BASE_URL}/dashboard/project/${c.id}`))}
    ${section("Pipeline Bid Dates", bidDates, p => row(escapeHtml(p.title), escapeHtml([p.stage, p.company].filter(Boolean).join(" · ")), p.bidDate, `${BASE_URL}/dashboard/pipeline/${p.id}`))}
    ${section("Closed Project Check-Ins", closedCheckIns, c => row(c.projectName || c.company, c.company, c.nextCheckIn, `${BASE_URL}/dashboard/project/${c.id}`))}
    ${section("Won Jobs To Convert", pipelineDue, p => row(p.title, p.company, p.nextCheckIn, `${BASE_URL}/dashboard/pipeline/${p.id}`))}
    ${total === 0 ? '<p style="color:#6b7280;">Nothing due right now.</p>' : ""}
  `;

  return {
    total,
    html: renderEmail({
      heading: "Your Upcoming Tasks",
      intro: intro || "Your scheduled digest, sent automatically.",
      bodyHtml
    })
  };
}
