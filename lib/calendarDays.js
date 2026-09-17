// The home calendar's shape. Mon-Fri are always there; Saturday and
// Sunday appear only while something is actually due on one, and go away
// again once it's done, moved, or deleted.
//
// Kept out of the page so it can be tested on its own.

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pad = n => String(n).padStart(2, "0");
export const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The week runs Monday-Sunday here, so Saturday is column 5 and Sunday 6 --
// both past Friday, which is what makes "is this a weekend column?" a
// simple `column >= 5`.
export const columnOf = (date) => (date.getDay() === 0 ? 6 : date.getDay() - 1);

// Four weeks starting from the Monday of the week `today` falls in.
export function buildCalendarWeeks(today = new Date()) {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const dow = start.getDay();
  start.setDate(start.getDate() + (dow === 0 ? -6 : 1 - dow));

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
