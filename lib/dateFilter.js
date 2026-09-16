// Date-range filter presets and matching, shared by the filter bar and by
// anything that has to re-apply the same filters (Analytics detail pages).
// No React, so it can be used and tested anywhere.

const pad = (n) => String(n).padStart(2, "0");
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromToday = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localKey(d);
};

// Each preset returns an inclusive [from, to] range of "YYYY-MM-DD" keys;
// null on either side means open-ended.
export const DATE_PRESETS = {
  overdue: { label: "Overdue", range: () => [null, daysFromToday(-1)] },
  today: { label: "Today", range: () => [daysFromToday(0), daysFromToday(0)] },
  next7: { label: "Next 7 days", range: () => [daysFromToday(0), daysFromToday(7)] },
  next30: { label: "Next 30 days", range: () => [daysFromToday(0), daysFromToday(30)] },
  last30: { label: "Last 30 days", range: () => [daysFromToday(-30), daysFromToday(0)] },
  last90: { label: "Last 90 days", range: () => [daysFromToday(-90), daysFromToday(0)] },
  thisYear: { label: "This year", range: () => [`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`] },
  lastYear: { label: "Last year", range: () => [`${new Date().getFullYear() - 1}-01-01`, `${new Date().getFullYear() - 1}-12-31`] }
};

// Whether a record's date (any string or Firestore timestamp starting with
// YYYY-MM-DD) passes a date filter. A record with no date only passes when
// the filter is off.
export function matchesDateFilter(date, filter) {
  if (!filter || !filter.preset) return true;
  const key = date?.seconds
    ? localKey(new Date(date.seconds * 1000))
    : (typeof date === "string" ? date.slice(0, 10) : "");
  if (!key) return false;

  let from = null;
  let to = null;
  if (filter.preset === "custom") {
    from = filter.from || null;
    to = filter.to || null;
  } else if (DATE_PRESETS[filter.preset]) {
    [from, to] = DATE_PRESETS[filter.preset].range();
  }
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

