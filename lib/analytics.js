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
