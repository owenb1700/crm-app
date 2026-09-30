// Rewriting the stored project statuses after they were renamed.
//
// The app already reads old names correctly through `normalizeCategory`,
// so nothing is broken before this runs -- but a record whose stored value
// says "Order" while every screen says "Under Contract/Ordered" is a trap
// for anything that ever compares the raw field, and for anyone reading
// the database directly. This brings the stored values in line.
//
// Two properties matter more than speed:
//
//   Idempotent. Running it twice changes nothing the second time, because
//   it only touches values that still need renaming. That makes it safe to
//   re-run after a partial failure, or by mistake.
//
//   Honest. Every rewrite appends a log entry naming the old value, so the
//   change is visible on the record rather than silently rewriting what a
//   job used to say.

import { needsMigrating, normalizeCategory } from "./projectCategories";

// What a single record needs, or null if it's already right.
export function plan(record) {
  const from = record?.category;
  if (!needsMigrating(from)) return null;
  const to = normalizeCategory(from);
  if (!to || to === from) return null;
  return { id: record.id, name: record.projectName || record.company || record.id, from, to };
}

// Everything that would change, without changing anything. This is what a
// dry run reports and what the apply step works from.
export function planAll(records) {
  return (records || []).map(plan).filter(Boolean);
}

export function summarize(plans) {
  const moves = {};
  plans.forEach(p => {
    const key = `${p.from} → ${p.to}`;
    moves[key] = (moves[key] || 0) + 1;
  });
  return { total: plans.length, moves };
}

export const migrationLogEntry = (from, to, when = new Date()) => ({
  type: "changed",
  outcome: `Status: ${from} → ${to}`,
  notes: "Project statuses were renamed; the stored value was brought in line.",
  timestamp: when.toISOString(),
  by: null
});
