// Estimating analytics over pipeline entries. Pure functions -- no Firebase.

// Who can open the Estimating Analytics page: Estimating and Admin always;
// anyone else only when an admin has turned on their "analytics"
// permission. Unlike the other feature toggles this one defaults to OFF,
// so turning it on for a salesperson is a deliberate choice.
export const canViewAnalytics = (profile) =>
  !!profile && !profile.disabled &&
  (profile.role === "admin" || profile.role === "estimating" || profile.permissions?.analytics === true);

// Estimated values are free text ("$1,250,000", "1.2M", "450k", "TBD").
// Returns a number of dollars, or null when there's no usable number.
export function parseMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim().toLowerCase().replace(/[$,\s]/g, "");
  const match = text.match(/^(-?\d+(?:\.\d+)?)(k|m|mm|mil|million|b|bn)?$/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = match[2];
  if (unit === "k") return n * 1e3;
  if (unit === "m" || unit === "mm" || unit === "mil" || unit === "million") return n * 1e6;
  if (unit === "b" || unit === "bn") return n * 1e9;
  return n;
}

export const formatMoney = (n) => {
  if (!n) return "$0";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};

export const statusOf = (entry) => {
  if (entry.outcome === "Won") return "won";
  if (entry.outcome === "Lost") return "lost";
  if (entry.outcome === "Did Not Bid") return "dnb";
  return "open";
};

// Counts and dollar volume for a set of pipeline entries.
// - "Bid on" = every entry except Did Not Bid.
// - Win rate = won / (won + lost): only decided bids, so open work and
//   jobs we passed on don't drag it down.
export function summarize(entries) {
  const s = {
    total: entries.length, won: 0, lost: 0, dnb: 0, open: 0,
    volume: { total: 0, won: 0, lost: 0, dnb: 0, open: 0 },
    missingValue: 0
  };
  entries.forEach(e => {
    const status = statusOf(e);
    s[status] += 1;
    const v = parseMoney(e.value);
    if (v === null) {
      s.missingValue += 1;
    } else {
      s.volume.total += v;
      s.volume[status] += v;
    }
  });
  s.bidOn = s.total - s.dnb;
  s.decided = s.won + s.lost;
  s.winRate = s.decided ? s.won / s.decided : null;
  s.avgWonValue = s.won ? s.volume.won / s.won : null;
  return s;
}

// Groups entries by a key function and summarizes each group, largest first.
export function breakdown(entries, keyOf) {
  const groups = new Map();
  entries.forEach(e => {
    const key = keyOf(e) || "Not set";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  return Array.from(groups.entries())
    .map(([key, list]) => ({ key, ...summarize(list) }))
    .sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
}

// Won / Lost / Did Not Bid counts per month of resolution, for the last
// `months` calendar months ending with the current one.
export function outcomesByMonth(entries, months = 12) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString(undefined, { month: "short" }),
      year: d.getFullYear(),
      won: 0, lost: 0, dnb: 0
    });
  }
  const byKey = new Map(buckets.map(b => [b.key, b]));
  entries.forEach(e => {
    const status = statusOf(e);
    if (status === "open" || !e.resolvedAt) return;
    const bucket = byKey.get(String(e.resolvedAt).slice(0, 7));
    if (bucket) bucket[status] += 1;
  });
  return buckets;
}

// Like breakdown(), but for fields where one entry belongs to several
// groups at once (e.g. every manufacturer quoted on it). An entry counts
// once in each of its groups, so group totals can add up to more than the
// number of entries.
export function breakdownMulti(entries, keysOf) {
  const groups = new Map();
  entries.forEach(e => {
    const keys = Array.from(new Set((keysOf(e) || []).map(k => (k || "").trim()).filter(Boolean)));
    (keys.length ? keys : ["Not set"]).forEach(key => {
      const existing = Array.from(groups.keys()).find(k => k.toLowerCase() === key.toLowerCase());
      const groupKey = existing || key;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(e);
    });
  });
  return Array.from(groups.entries())
    .map(([key, list]) => ({ key, ...summarize(list) }))
    .sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
}

// Every manufacturer quoted on an entry: its equipment rows, plus the older
// single tower-manufacturer field.
export const manufacturersOf = (entry) => [
  ...(entry.equipment || []).map(r => r.manufacturer),
  entry.towerManufacturer
];

const pad2 = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Open pipeline work by how soon it bids. Windows don't overlap: "31–60"
// excludes anything already counted in "Next 30 days". Past-due means the
// bid date has passed but the entry still has no outcome.
export function bidForecast(entries) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const plus = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  };
  const todayKey = dayKey(today);
  const edges = { d30: plus(30), d60: plus(60), d90: plus(90) };

  const windows = {
    pastDue: { label: "Bid date passed", entries: [] },
    next30: { label: "Next 30 days", entries: [] },
    next60: { label: "31–60 days", entries: [] },
    next90: { label: "61–90 days", entries: [] },
    later: { label: "Later or no bid date", entries: [] }
  };

  entries.filter(e => statusOf(e) === "open").forEach(e => {
    const key = e.bidDate ? String(e.bidDate).slice(0, 10) : "";
    if (!key) windows.later.entries.push(e);
    else if (key < todayKey) windows.pastDue.entries.push(e);
    else if (key <= edges.d30) windows.next30.entries.push(e);
    else if (key <= edges.d60) windows.next60.entries.push(e);
    else if (key <= edges.d90) windows.next90.entries.push(e);
    else windows.later.entries.push(e);
  });

  Object.values(windows).forEach(w => {
    w.count = w.entries.length;
    w.volume = w.entries.reduce((sum, e) => sum + (parseMoney(e.value) || 0), 0);
  });

  const upcoming = [...windows.next30.entries, ...windows.next60.entries, ...windows.next90.entries]
    .sort((a, b) => String(a.bidDate).localeCompare(String(b.bidDate)));

  return { windows, upcoming };
}
