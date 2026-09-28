// The calendar's shape, shared by Home and Project Scheduling. Mon-Fri
// are always there; Saturday and Sunday appear only while something is
// actually due on one, and go away again once it's done, moved, or
// deleted.
//
// The four weeks shown start from an anchor date rather than always from
// today, so the pages can step back and forward through the year.
//
// Kept out of the page so it can be tested on its own.

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pad = n => String(n).padStart(2, "0");
export const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The week runs Monday-Sunday here, so Saturday is column 5 and Sunday 6 --
// both past Friday, which is what makes "is this a weekend column?" a
// simple `column >= 5`.
export const columnOf = (date) => (date.getDay() === 0 ? 6 : date.getDay() - 1);

// The Monday of the week a date falls in.
export function startOfWeek(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const dow = start.getDay();
  start.setDate(start.getDate() + (dow === 0 ? -6 : 1 - dow));
  return start;
}

// `n` weeks either side of a date -- negative goes back.
export function shiftWeeks(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() + n * 7);
  return out;
}

// A "YYYY-MM-DD" string as a local Date, without the UTC-midnight shift
// that `new Date("2026-10-05")` would give.
export function dateFromKey(key) {
  const [y, m, d] = String(key || "").slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

// Four weeks starting from the Monday of the week `anchor` falls in.
// `today` is separate so the calendar can be scrolled into other weeks
// while still knowing which square is actually today.
export function buildCalendarWeeks(anchor = new Date(), today = new Date()) {
  const start = startOfWeek(anchor);

  const todayKey = dateKey(today);
  const days = [];
  const cursor = new Date(start);
  while (days.length < 28) {
    const key = dateKey(cursor);
    days.push({ date: new Date(cursor), key, isToday: key === todayKey, column: columnOf(cursor) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// Which weekend columns have something on them. A column is shown for all
// four weeks at once, so the grid stays rectangular and the day headings
// keep lining up with the days below them.
export function weekendColumnsFor(days, hasItemsOn) {
  const shown = new Set();
  days.forEach(({ key, column }) => {
    if (column >= 5 && hasItemsOn(key)) shown.add(column);
  });
  return shown;
}

export const visibleCalendarDays = (days, weekendColumns) =>
  days.filter(({ column }) => column < 5 || weekendColumns.has(column));

export const columnLabels = (weekendColumns) =>
  WEEKDAY_LABELS.filter((_, i) => i < 5 || weekendColumns.has(i));

// Which day an alert sits on: the day it's actually due, weekend included.
// Anything already overdue is pulled onto today so it can't sit in the past
// where nobody would look.
export function calendarKeyFor(due, today = new Date()) {
  const day = String(due || "").slice(0, 10);
  if (!day) return "";
  const todayKey = dateKey(today);
  return day < todayKey ? todayKey : day;
}

// The mm/dd/yy box on the calendar navigation. Segments -> a Date, or
// null if it isn't a real one. Two-digit years are this century, and
// 02/31 is rejected rather than rolled into March the way `new Date`
// would quietly do.
export function dateFromSegments({ month, day, year }) {
  if (String(month).length !== 2 || String(day).length !== 2 || String(year).length !== 2) return null;
  const m = Number(month);
  const d = Number(day);
  const y = 2000 + Number(year);
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const out = new Date(y, m - 1, d);
  return out.getMonth() === m - 1 && out.getDate() === d ? out : null;
}
