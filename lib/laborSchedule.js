import { peopleForStorage } from "./crew";

// When the work actually happens, who is on it, and how many each day.
//
// Kept on the project itself, so the project page and the scheduling
// calendar are reading and writing the same thing -- there is no second
// copy to fall out of step.
//
// Days run consecutively from a start date and skip Saturday and Sunday,
// unless someone says the crew is working the weekend. Men are set per
// day, because the last day of a job is usually lighter than the first;
// "same every day" just fills every row with one number.

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;

const toUTC = (day) => {
  const [y, m, d] = String(day || "").slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};

const isWeekend = (dt) => dt.getUTCDay() === 0 || dt.getUTCDay() === 6;

export const MAX_DAYS = 60;

export const blankLaborSchedule = () => ({ days: [], includeWeekends: false });

// The dates a job of `count` days runs over, starting at `start`.
// Weekends are skipped unless asked for; a start date that lands on a
// weekend is honoured either way -- if someone picked Saturday, they
// meant Saturday.
export function sequentialDays(start, count, includeWeekends = false) {
  const first = toUTC(start);
  const total = Math.max(0, Math.min(MAX_DAYS, Math.round(Number(count) || 0)));
  if (!first || !total) return [];

  const out = [isoOf(first)];
  const cursor = new Date(first.getTime());
  while (out.length < total) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (includeWeekends || !isWeekend(cursor)) out.push(isoOf(cursor));
  }
  return out;
}

// Re-dates an existing set of rows, keeping the men already entered
// against each position so changing the start date doesn't wipe them.
export function rebuildDays({ start, count, includeWeekends, existing = [], defaultMen = 0 }) {
  const dates = sequentialDays(start, count, includeWeekends);
  return dates.map((date, i) => ({
    date,
    men: Number(existing[i]?.men ?? defaultMen) || 0
  }));
}

export const withSameMen = (days, men) =>
  (days || []).map(d => ({ ...d, men: Math.max(0, Math.round(Number(men) || 0)) }));

// What gets stored: sorted, de-duplicated, nothing undefined, and rows
// with nobody on them dropped -- a day with no men isn't a work day.
//
// The names on a day come through here too. They were being rebuilt away
// by this function: it made each day fresh from date and men, so anyone
// named on it was quietly dropped on save.
export function laborForStorage(schedule) {
  const seen = new Set();
  const days = (schedule?.days || [])
    .map(d => {
      const people = peopleForStorage(d?.people);
      return {
        date: String(d?.date || "").slice(0, 10),
        // Four people named can't be a three-man day.
        men: Math.max(Math.max(0, Math.round(Number(d?.men) || 0)), people.length),
        people
      };
    })
    .filter(d => d.date && d.men > 0)
    .filter(d => (seen.has(d.date) ? false : seen.add(d.date)))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { days, includeWeekends: schedule?.includeWeekends === true };
}

export const hasLabor = (record) => (record?.laborSchedule?.days || []).length > 0;

export const laborDays = (record) => record?.laborSchedule?.days || [];

export const totalManDays = (record) =>
  laborDays(record).reduce((sum, d) => sum + (Number(d.men) || 0), 0);

export const peakMen = (record) =>
  laborDays(record).reduce((most, d) => Math.max(most, Number(d.men) || 0), 0);

export const firstDay = (record) => laborDays(record)[0]?.date || "";
export const lastDay = (record) => laborDays(record)[laborDays(record).length - 1]?.date || "";

// "3 days · 11 man-days · 4 men at peak"
export function describeLabor(record) {
  const days = laborDays(record);
  if (!days.length) return "";
  const dayWord = days.length === 1 ? "day" : "days";
  return `${days.length} ${dayWord} · ${totalManDays(record)} man-days · ${peakMen(record)} at peak`;
}

// Every scheduled day across every project, indexed by date, for the
// calendar to draw. Each entry knows the project it came from so the
// popup can open it.
export function laborByDate(projects) {
  const byDate = new Map();
  (projects || []).forEach(project => {
    laborDays(project).forEach(({ date, men }) => {
      const list = byDate.get(date) || [];
      list.push({
        projectId: project.id,
        name: project.projectName || project.company || "Untitled project",
        company: project.company || "",
        ownerId: project.ownerId || "",
        men: Number(men) || 0,
        date
      });
      byDate.set(date, list);
    });
  });
  // Busiest job first on any given day.
  byDate.forEach(list => list.sort((a, b) => b.men - a.men || a.name.localeCompare(b.name)));
  return byDate;
}

export const menOnDate = (byDate, date) =>
  (byDate.get(date) || []).reduce((sum, e) => sum + e.men, 0);

// How many men the company can field on one day. Going over isn't
// blocked -- plenty of jobs get scheduled knowing they'll be sorted out --
// but nobody should book the day without being told.
export const CREW_CAPACITY = 8;

export const isOverbooked = (byDate, date) => menOnDate(byDate, date) > CREW_CAPACITY;

// Every overbooked day in a set, for the page to count and flag.
export const overbookedDates = (byDate) =>
  [...byDate.keys()].filter(date => isOverbooked(byDate, date)).sort();

// What to tell someone about a day before they add to it. `excludeProjectId`
// leaves the job being edited out of the running total, so re-saving a
// schedule doesn't count its own men twice.
export function dayLoad(byDate, date, { excludeProjectId = null, adding = 0 } = {}) {
  const entries = (byDate.get(date) || []).filter(e => e.projectId !== excludeProjectId);
  const already = entries.reduce((sum, e) => sum + e.men, 0);
  const total = already + Math.max(0, Math.round(Number(adding) || 0));
  return {
    already,
    total,
    capacity: CREW_CAPACITY,
    over: total > CREW_CAPACITY,
    overBy: Math.max(0, total - CREW_CAPACITY),
    jobs: entries
  };
}

// One line for the editor and the popup: what's already on the day, and
// whether this puts it over.
export function describeDayLoad(load) {
  if (!load) return "";
  const men = (n) => `${n} ${n === 1 ? "man" : "men"}`;
  if (!load.already) {
    return load.over
      ? `${men(load.total)} on this day — ${load.overBy} over the usual ${load.capacity}.`
      : `Nothing else booked this day.`;
  }
  const others = `${men(load.already)} already booked${load.jobs.length ? ` on ${load.jobs.length === 1 ? load.jobs[0].name : `${load.jobs.length} other jobs`}` : ""}`;
  return load.over
    ? `${others} — this takes the day to ${men(load.total)}, ${load.overBy} over the usual ${load.capacity}.`
    : `${others} — this takes the day to ${load.total} of ${load.capacity}.`;
}
