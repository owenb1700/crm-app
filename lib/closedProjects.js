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

export const isClosedWithCheckIn = (c) => c.category === "Project Closed" && c.closedOutcome === CLOSED_OUTCOME;

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

export function checkInUpdatePayload(project, { person, notes, byName }) {
  const now = new Date();
  const nextCheckIn = yearsFrom(now, UPDATE_CHECK_IN_YEARS);
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
