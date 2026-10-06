// A running record of how much data there is, so growth is something you
// can look at rather than estimate.
//
// Reading only. The writing half lives in growthLog.server.js, because it
// needs the admin SDK and this file is imported by the dashboard -- a
// dynamic import is still a static dependency as far as the bundler is
// concerned, and it dragged firebase-admin into the browser.
//
// The nightly backup already reads every collection and counts it. Those
// counts went into cronRuns, which is culled after 30 days and which
// nothing ever displayed -- measured every night and thrown away unseen.
// They are kept here instead: one document per month, so a year of
// history is twelve small reads and there is nothing to prune.

export const GROWTH_COLLECTION = "growth";

// What one dashboard load actually costs. Every one of these is read in
// full on the client -- there is no limit() anywhere in the app -- so the
// sum of them is the number of Firestore reads it takes one person to
// open the app once, and the number that decides both the bill and how
// long they wait.
export const DASHBOARD_COLLECTIONS = ["customers", "pipeline", "parts", "users", "contacts", "companies"];

// Firestore's free allowance, for something to measure against.
export const FREE_READS_PER_DAY = 50000;

export const monthKey = (date = new Date()) => String(date.toISOString()).slice(0, 7);
export const dayKey = (date = new Date()) => String(date.toISOString()).slice(0, 10);

export const dashboardReadsPerLoad = (counts) =>
  DASHBOARD_COLLECTIONS.reduce((sum, name) => sum + (counts?.[name] || 0), 0);

export const totalRecords = (counts) =>
  Object.values(counts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);

// Every day on record, oldest first, flattened out of the monthly
// documents.
export function daysFrom(months) {
  return (months || [])
    .flatMap(m => Object.entries(m?.days || {}).map(([day, data]) => ({ day, ...data })))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export const latestDay = (days) => (days || [])[days.length - 1] || null;

// What it was n days ago -- the most recent reading on or before that day,
// since a backup that didn't run leaves a gap.
export function dayBefore(days, daysAgo, from = new Date()) {
  const target = new Date(from);
  target.setDate(target.getDate() - daysAgo);
  const cutoff = dayKey(target);
  const earlier = (days || []).filter(d => d.day <= cutoff);
  return earlier[earlier.length - 1] || null;
}

// "+134 (+11%)". Nothing to compare against reads as such rather than as
// a change of zero.
export function changeSince(days, daysAgo, field = "totalRecords", from = new Date()) {
  const now = latestDay(days);
  const then = dayBefore(days, daysAgo, from);
  if (!now || !then || then.day === now.day) return null;
  const before = Number(then[field]) || 0;
  const after = Number(now[field]) || 0;
  return {
    from: before,
    to: after,
    added: after - before,
    percent: before ? Math.round(((after - before) / before) * 100) : null,
    since: then.day
  };
}

export const describeChange = (change) => {
  if (!change) return "not enough history yet";
  const sign = change.added >= 0 ? "+" : "";
  const pct = change.percent === null ? "" : ` (${sign}${change.percent}%)`;
  return `${sign}${change.added.toLocaleString()}${pct}`;
};
