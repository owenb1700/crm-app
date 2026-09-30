// Did the equipment turn up when they said it would?
//
// Both halves of that question have been recorded for a while -- the lead
// time quoted when the job was entered, and the day it actually shipped --
// and nothing ever put them next to each other. Over a year that is the
// difference between believing a supplier's number and knowing it.
//
// Everything here reads; nothing writes, and nothing here changes what a
// job says. A job with no quoted lead time, or one that hasn't shipped,
// simply isn't counted yet.

import { parseLeadTime, businessDaysBetween } from "./leadTimes";
import { equipmentRowsFrom } from "./equipment";

const day = (v) => String(v || "").slice(0, 10);

// What one job's equipment actually did against what was promised.
// Positive `varianceDays` is late, negative is early.
export function leadTimeActual(record, { defaultUnit = "weeks" } = {}) {
  const quoted = parseLeadTime(record?.leadTime, { defaultUnit });
  const orderedOn = day(record?.orderedOn);
  const shippedOn = day(record?.shippedOn);
  if (!quoted || !orderedOn || !shippedOn) return null;
  if (shippedOn < orderedOn) return null;

  const actualDays = businessDaysBetween(orderedOn, shippedOn);
  return {
    quotedDays: quoted.days,
    actualDays,
    varianceDays: actualDays - quoted.days,
    orderedOn,
    shippedOn,
    // A range was quoted as a middle; say so, because "two days late"
    // against a 6-8 week range is inside what they actually promised.
    wasRange: quoted.isRange
  };
}

export const isLate = (actual, grace = 0) => !!actual && actual.varianceDays > grace;
export const isEarly = (actual) => !!actual && actual.varianceDays < 0;

// Every manufacturer named on a job. The quoted lead time is the longest
// component's and they ship together, so a job with three makers counts
// once for each -- the figure answers "when I buy from them, does it turn
// up on time", not "whose fault was this job".
export function makersOn(record) {
  const seen = new Set();
  return (equipmentRowsFrom(record) || [])
    .map(r => String(r?.manufacturer || "").trim())
    .filter(Boolean)
    // Matched the Directory's way, so "A Co" and "a co" on the same job
    // are one supplier and not two. First spelling wins.
    .filter(name => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;

// How each manufacturer has actually performed, worst average first, so
// the ones worth a conversation are at the top.
export function performanceByManufacturer(records, { defaultUnit = "weeks", grace = 0 } = {}) {
  const byMaker = new Map();

  (records || []).filter(Boolean).forEach(record => {
    const actual = leadTimeActual(record, { defaultUnit });
    if (!actual) return;
    makersOn(record).forEach(maker => {
      const key = maker.toLowerCase();
      const row = byMaker.get(key) || { manufacturer: maker, shipments: [] };
      row.shipments.push({
        ...actual,
        jobId: record.id,
        jobName: record.projectName || record.title || record.item || ""
      });
      byMaker.set(key, row);
    });
  });

  return [...byMaker.values()]
    .map(({ manufacturer, shipments }) => {
      const variances = shipments.map(s => s.varianceDays);
      const late = shipments.filter(s => s.varianceDays > grace).length;
      return {
        manufacturer,
        jobs: shipments.length,
        late,
        onTime: shipments.length - late,
        onTimeRate: Math.round(((shipments.length - late) / shipments.length) * 100),
        avgQuotedDays: round1(mean(shipments.map(s => s.quotedDays))),
        avgActualDays: round1(mean(shipments.map(s => s.actualDays))),
        avgVarianceDays: round1(mean(variances)),
        worstVarianceDays: Math.max(...variances),
        shipments
      };
    })
    .sort((a, b) => b.avgVarianceDays - a.avgVarianceDays || a.manufacturer.localeCompare(b.manufacturer));
}

// "3 business days later than quoted, on average" / "on the day, on average"
export function describeVariance(days) {
  const n = Math.abs(round1(days));
  if (!n) return "on the day";
  return `${n} business ${n === 1 ? "day" : "days"} ${days > 0 ? "late" : "early"}`;
}
