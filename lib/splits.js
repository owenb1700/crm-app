// Credit splits: a project or pipeline entry can be shared between people,
// each with a percentage. The split decides how the job counts toward each
// person's numbers; everyone on it also works the job (they get it on My
// Projects and in their alerts, like a collaborator).
//
// No splits set = the whole job counts for its salesperson / owner, which is
// how everything worked before.

export const normalizeSplits = (splits) =>
  (splits || [])
    .filter(s => s && s.userId && Number(s.percent) > 0)
    .map(s => ({ userId: s.userId, percent: Math.round(Number(s.percent) * 10) / 10 }));

export const splitsTotal = (splits) => normalizeSplits(splits).reduce((sum, s) => sum + s.percent, 0);

// A split has to add up to 100% (or not exist at all), and can't name the
// same person twice. Returns an error message, or "" when it's fine.
export function splitError(splits) {
  const clean = normalizeSplits(splits);
  if (!clean.length) return "";
  const ids = new Set(clean.map(s => s.userId));
  if (ids.size !== clean.length) return "Each person can only appear once in the split.";
  const total = splitsTotal(clean);
  if (Math.abs(total - 100) > 0.05) return `The split has to add up to 100% (it's ${Math.round(total * 10) / 10}% right now).`;
  return "";
}

// Who this job counts for, and how much of it each person gets.
export function splitShares(record, fallbackUserId) {
  const clean = normalizeSplits(record?.splits);
  if (!clean.length) return fallbackUserId ? [{ userId: fallbackUserId, weight: 1 }] : [];
  const total = splitsTotal(clean) || 100;
  return clean.map(s => ({ userId: s.userId, weight: s.percent / total }));
}

export const hasShare = (record, userId) => normalizeSplits(record?.splits).some(s => s.userId === userId);

// Everyone on the split works the job too, so they're added to the field
// that already grants that (collaboratorIds on projects, trackedByIds on
// pipeline entries).
export const withSplitMembers = (existingIds, splits, exceptId) => {
  const ids = new Set(existingIds || []);
  normalizeSplits(splits).forEach(s => {
    if (s.userId !== exceptId) ids.add(s.userId);
  });
  return [...ids];
};

// "Alice 60% · Bob 40%"
export const describeSplit = (splits, nameOf) =>
  normalizeSplits(splits).map(s => `${nameOf(s.userId)} ${s.percent}%`).join(" · ");
