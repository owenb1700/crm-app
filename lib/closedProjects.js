// A project closed with the "Project Closed" outcome sits in Past Projects
// with a check-in for its owner: 1 year after closing, then 2 years after
// each logged Update. The owner can also snooze it to any date.
export const CLOSED_OUTCOME = "Closed";
export const FIRST_CHECK_IN_YEARS = 1;
export const UPDATE_CHECK_IN_YEARS = 2;

const pad = (n) => String(n).padStart(2, "0");
export const localDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const fromKey = (key) => {
  const [y, m, d] = (key || "").slice(0, 10).split("-").map(Number);
  return y ? new Date(y, m - 1, d) : new Date();
};

// Weekend dates move to Monday -- the Home calendar shows weekdays only.
export const weekdayKey = (d) => {
  const next = new Date(d);
  // Saturday and Sunday move back to the Friday before -- a follow-up is
  // better early than late.
  if (next.getDay() === 6) next.setDate(next.getDate() - 1);
  if (next.getDay() === 0) next.setDate(next.getDate() - 2);
  return localDateKey(next);
};

export const yearsFrom = (base, years) => {
  const d = base instanceof Date ? new Date(base) : fromKey(base);
  d.setFullYear(d.getFullYear() + years);
  return weekdayKey(d);
};

// A closed job that still wants chasing. Two of them: one closed with the
// plain "Project Closed" outcome, which always gets a check-in, and a job
// closed because the bid was lost, which only gets one if somebody asked
// for a date when they recorded the loss.
export const isClosedWithCheckIn = (c) =>
  c?.category === "Project Closed" &&
  (c.closedOutcome === CLOSED_OUTCOME || (c.closedOutcome === "Lost" && !!c.nextCheckIn));

// The check-in on a lost bid is opt-in. Before this a lost job quietly got
// one a year out whether anyone wanted it or not, and nothing on the page
// said so -- so it came back at you with no way to act on it. Blank means
// no check-in at all.
export function lostCheckIn(dateKey) {
  const key = String(dateKey || "").slice(0, 10);
  return key ? weekdayKey(fromKey(key)) : null;
}

// A date to come back on has to be in the future; today or earlier is
// somebody mistyping a year.
export function lostCheckInProblem(dateKey, today = localDateKey(new Date())) {
  const key = String(dateKey || "").slice(0, 10);
  if (!key) return "";
  if (key <= String(today).slice(0, 10)) return "Pick a date after today, or leave it blank.";
  return "";
}

// Due today or earlier, in the viewer's local calendar.
export const isCheckInDue = (c) => !!c.nextCheckIn && String(c.nextCheckIn).slice(0, 10) <= localDateKey(new Date());

export function closeProjectPayload(activityLog = []) {
  const now = new Date();
  return {
    category: "Project Closed",
    closedOutcome: CLOSED_OUTCOME,
    closedAt: now.toISOString(),
    nextCheckIn: yearsFrom(now, FIRST_CHECK_IN_YEARS),
    activityLog: [...activityLog, { type: "completed", outcome: "Project Closed", timestamp: now.toISOString() }]
  };
}

// Logging a check-in moves to the next one the plan asked for -- the
// five-year call after the one-year call, say -- and only falls back to
// "two years from now" for projects closed before plans existed.
export function checkInUpdatePayload(project, { person, notes, byName }) {
  const now = new Date();
  const nextCheckIn = nextPlannedCheckIn(project, now);
  return {
    nextCheckIn,
    lastContact: localDateKey(now),
    activityLog: [
      ...(project.activityLog || []),
      { type: "check-in", outcome: `Checked in with ${person}`, notes: notes || null, by: byName, nextDueDate: nextCheckIn, timestamp: now.toISOString() }
    ]
  };
}

export function snoozePayload(project, { dateKey, byName }) {
  const nextCheckIn = weekdayKey(fromKey(dateKey));
  return {
    nextCheckIn,
    activityLog: [
      ...(project.activityLog || []),
      { type: "snoozed", outcome: `Check-in snoozed to ${nextCheckIn}`, by: byName, nextDueDate: nextCheckIn, timestamp: new Date().toISOString() }
    ]
  };
}

// ---- what a finished job's check-ins look like ----
//
// A job you did is worth going back to twice: about a year on, to hear
// how the equipment is running, and again years later when maintenance
// and replacement come up. Both are offered when the project closes and
// either can be turned off, because not every job wants chasing.
//
// A custom interval covers the customers you keep in touch with on your
// own rhythm -- it keeps going after the planned dates run out.

export const CHECK_IN_OFFERS = [
  { key: "oneYear", years: 1, label: "Check in after 1 year", why: "How the equipment is running." },
  { key: "fiveYears", years: 5, label: "Check in after 5 years", why: "Maintenance and replacement." }
];

export const CHECK_IN_UNITS = ["years", "months"];

export const blankCheckInPlan = () => ({ oneYear: true, fiveYears: true, every: "", everyUnit: "years" });

const addMonths = (base, months) => {
  const d = base instanceof Date ? new Date(base) : fromKey(base);
  d.setMonth(d.getMonth() + months);
  return weekdayKey(d);
};

const monthsIn = (value, unit) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return unit === "months" ? n : n * 12;
};

// A repeat of "every 0 years" would schedule the same day forever.
export function checkInPlanProblem(plan) {
  const raw = String(plan?.every ?? "").trim();
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || Math.round(n) !== n) return "A repeat has to be a whole number of months or years.";
  if (monthsIn(n, plan.everyUnit) > 12 * 25) return "Twenty-five years is as far out as a repeat goes.";
  return "";
}

// The dates themselves, in order, from the day the job closed.
export function checkInPlanPayload(plan, from = new Date()) {
  const dates = CHECK_IN_OFFERS
    .filter(o => plan?.[o.key])
    .map(o => yearsFrom(from, o.years));
  const repeatMonths = monthsIn(plan?.every, plan?.everyUnit);
  const schedule = [...new Set(dates)].sort();
  return {
    checkInSchedule: schedule,
    checkInEveryMonths: repeatMonths || null,
    nextCheckIn: schedule[0] || (repeatMonths ? addMonths(from, repeatMonths) : null)
  };
}

// Where the next check-in lands once this one is dealt with: the next
// planned date, then the repeat if there is one, then nothing. Projects
// closed before any of this existed have no plan, so they keep the old
// behaviour of two years after each update.
export function nextPlannedCheckIn(project, after = new Date()) {
  const key = typeof after === "string" ? after.slice(0, 10) : localDateKey(after);
  const ahead = (project?.checkInSchedule || []).filter(d => String(d).slice(0, 10) > key).sort();
  if (ahead.length) return ahead[0];
  if (project?.checkInEveryMonths) return addMonths(key, project.checkInEveryMonths);
  if (project?.checkInSchedule || project?.checkInEveryMonths === null) return null;
  return yearsFrom(key, UPDATE_CHECK_IN_YEARS);
}

// "After 1 year and 5 years" -- what the project page says it will do.
export function describeCheckInPlan(plan) {
  const picked = CHECK_IN_OFFERS.filter(o => plan?.[o.key]).map(o => (o.years === 1 ? "1 year" : `${o.years} years`));
  const months = monthsIn(plan?.every, plan?.everyUnit);
  const every = months
    ? `every ${months % 12 === 0 ? `${months / 12} year${months === 12 ? "" : "s"}` : `${months} month${months === 1 ? "" : "s"}`}`
    : "";
  if (!picked.length && !every) return "No check-ins — it closes quietly.";
  const parts = [picked.length ? `after ${picked.join(" and ")}` : "", every].filter(Boolean);
  return `Check in ${parts.join(", then ")}.`;
}

// ---- putting a check-in off once it has come back ----
//
// The plan says when to go back to a customer; this is what happens when
// that day arrives and it isn't the right week. Two months for "call me
// after the season", a year or two for "nothing is changing here", and
// indefinitely for the ones that are genuinely finished with.

export const SNOOZE_OPTIONS = [
  { key: "twoMonths", label: "2 months", months: 2 },
  { key: "oneYear", label: "1 year", months: 12 },
  { key: "twoYears", label: "2 years", months: 24 }
];

export function snoozeMonthsPayload(project, { months, byName }) {
  return snoozePayload(project, { dateKey: addMonths(new Date(), months), byName });
}

// Stopping has to take the plan with it. Clearing the date alone would
// leave the repeat -- or the five-year call -- to put it straight back,
// and the person who pressed "indefinitely" would see it again anyway.
export function stopCheckInsPayload(project, { byName } = {}) {
  return {
    nextCheckIn: null,
    checkInSchedule: [],
    checkInEveryMonths: null,
    activityLog: [
      ...(project?.activityLog || []),
      {
        type: "snoozed",
        outcome: "Check-ins stopped — no more reminders for this job",
        by: byName || null,
        nextDueDate: null,
        timestamp: new Date().toISOString()
      }
    ]
  };
}

// Whether there is anything left to stop.
export const hasCheckInsComing = (c) =>
  !!c?.nextCheckIn || !!(c?.checkInSchedule || []).length || !!c?.checkInEveryMonths;
