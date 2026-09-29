import { peopleForStorage, peopleOn, crewNames } from "./crew";

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
    laborDays(project).forEach(({ date, men, people }) => {
      const list = byDate.get(date) || [];
      list.push({
        projectId: project.id,
        name: project.projectName || project.company || "Untitled project",
        company: project.company || "",
        ownerId: project.ownerId || "",
        men: Number(men) || 0,
        people: peopleOn({ people }),
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

// How many people the company can field on one day: however many are on
// the crew list. They hire and fire, so the number has to move with the
// list rather than sit in the code -- eight was only ever what the list
// happened to hold.
//
// An empty list means nobody has written down who the crew are, and a
// number nobody set isn't worth warning against, so capacity checks stay
// quiet until there's a list.
export const crewCapacity = (crew) => crewNames(crew).length;

export const isOverbooked = (byDate, date, capacity) =>
  capacity > 0 && menOnDate(byDate, date) > capacity;

// Every day that's over the crew, for the page to count and flag.
export const overbookedDates = (byDate, capacity) =>
  [...byDate.keys()].filter(date => isOverbooked(byDate, date, capacity)).sort();

// ---- one person, two jobs, one day ----
//
// The count going over the crew and a particular person being in two
// places are different problems. A day can be well under capacity and
// still have Dan on two jobs; a day can be over capacity with nobody
// double booked, because the extra men are outside labour. Both get
// warned about, neither gets blocked -- multiple jobs land on one day all
// the time and somebody splits their day between them on purpose.
export function doubleBooked(entries) {
  const where = new Map();
  (entries || []).forEach(entry => {
    (entry.people || []).forEach(person => {
      const key = String(person).trim().toLowerCase();
      if (!key) return;
      const seen = where.get(key) || { name: String(person).trim(), jobs: [], jobIds: new Set() };
      if (!seen.jobIds.has(entry.projectId)) {
        seen.jobIds.add(entry.projectId);
        seen.jobs.push(entry.name);
      }
      where.set(key, seen);
    });
  });
  return [...where.values()]
    .filter(p => p.jobs.length > 1)
    .map(({ name, jobs }) => ({ name, jobs }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const clashesOn = (byDate, date) => doubleBooked(byDate.get(date) || []);

export const clashDates = (byDate) =>
  [...byDate.keys()].filter(date => clashesOn(byDate, date).length).sort();

// Every day worth a mark on the calendar, and why. A day can be both.
export function flaggedDates(byDate, capacity) {
  const dates = new Set([...overbookedDates(byDate, capacity), ...clashDates(byDate)]);
  return [...dates].sort();
}

// What to tell someone about a day before they add to it.
// `excludeProjectId` leaves the job being edited out of the running
// total, so re-saving a schedule doesn't count its own men twice -- and
// `people` puts that job's names back in for the clash check, since the
// whole question is whether they're already somewhere else.
export function dayLoad(byDate, date, {
  excludeProjectId = null,
  adding = 0,
  people = [],
  jobName = "this job",
  capacity = 0
} = {}) {
  const entries = (byDate.get(date) || []).filter(e => e.projectId !== excludeProjectId);
  const already = entries.reduce((sum, e) => sum + e.men, 0);
  const total = already + Math.max(0, Math.round(Number(adding) || 0));
  const mine = { projectId: excludeProjectId || "__editing", name: jobName, people: peopleOn({ people }) };
  const clashes = doubleBooked(mine.people.length ? [...entries, mine] : entries);
  return {
    already,
    total,
    capacity,
    over: capacity > 0 && total > capacity,
    overBy: capacity > 0 ? Math.max(0, total - capacity) : 0,
    jobs: entries,
    clashes
  };
}

// One line for the editor and the popup: what's already on the day, and
// whether this puts it over.
export function describeDayLoad(load) {
  if (!load) return "";
  const men = (n) => `${n} ${n === 1 ? "man" : "men"}`;
  const of = load.capacity > 0 ? ` of ${load.capacity}` : "";
  if (!load.already) {
    return load.over
      ? `${men(load.total)} on this day — ${load.overBy} more than the crew.`
      : "Nothing else booked this day.";
  }
  const others = `${men(load.already)} already booked${load.jobs.length ? ` on ${load.jobs.length === 1 ? load.jobs[0].name : `${load.jobs.length} other jobs`}` : ""}`;
  return load.over
    ? `${others} — this takes the day to ${men(load.total)}, ${load.overBy} more than the crew.`
    : `${others} — this takes the day to ${load.total}${of}.`;
}

// "Dan Helm is on two jobs this day: Smith Tower and Elgin High."
export function describeClashes(clashes) {
  const list = clashes || [];
  if (!list.length) return "";
  if (list.length === 1) {
    const [p] = list;
    const where = p.jobs.length === 2 ? p.jobs.join(" and ") : `${p.jobs.slice(0, -1).join(", ")} and ${p.jobs[p.jobs.length - 1]}`;
    return `${p.name} is on ${p.jobs.length === 2 ? "two jobs" : `${p.jobs.length} jobs`} this day: ${where}.`;
  }
  const names = list.map(p => p.name);
  const joined = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list.length} people are on more than one job this day: ${joined}.`;
}
