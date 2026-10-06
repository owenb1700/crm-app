// How close a record is to the size a Firestore document is allowed to be.
//
// A project's history lives in an `activityLog` array inside the project
// itself -- every stage change, check-in, snooze, close and reassignment
// appends to it. Firestore caps a document at 1 MiB, and the cap is on the
// whole document: past it, the project stops accepting writes entirely,
// not just the log. There is no warning and no partial failure. It would
// simply stop saving one day.
//
// A normal job logs a few dozen entries in its life, so the ceiling is
// years away. This is here so that if something ever starts writing in
// bulk, somebody hears about it with room to act rather than finding out
// when a job won't save.

export const DOC_LIMIT_BYTES = 1048576;

// Early enough to be a conversation rather than an emergency: at two
// thirds there is still a third of the room left, which at any sane rate
// of logging is a very long time.
export const WARN_FRACTION = 2 / 3;
export const WARN_BYTES = Math.round(DOC_LIMIT_BYTES * WARN_FRACTION);

// Close enough. Firestore's own encoding isn't JSON and counts field names
// and types differently, so this is an estimate -- but it tracks the real
// size well enough to raise a flag a long way out, which is all it is for.
export function estimateBytes(record) {
  try {
    return new TextEncoder().encode(JSON.stringify(record ?? {})).length;
  } catch {
    // A circular or unserialisable record isn't something to crash a
    // nightly job over.
    return 0;
  }
}

export const percentOfLimit = (bytes) => Math.round((bytes / DOC_LIMIT_BYTES) * 100);

// The records worth saying something about, biggest first.
export function oversizedRecords(records, { kind = "record", warnBytes = WARN_BYTES } = {}) {
  return (records || [])
    .map(r => ({
      id: r?.id,
      kind,
      name: r?.projectName || r?.title || r?.company || r?.id || "(unnamed)",
      bytes: estimateBytes(r),
      logEntries: (r?.activityLog || []).length
    }))
    .filter(r => r.bytes >= warnBytes)
    .sort((a, b) => b.bytes - a.bytes);
}

export function describeOversized(list) {
  return (list || [])
    .map(r => `${r.kind} "${r.name}" (${r.id}) — about ${Math.round(r.bytes / 1024)} KB, ${percentOfLimit(r.bytes)}% of the limit, ${r.logEntries} activity entries`)
    .join("\n");
}

export const oversizedSummary = (list) => {
  const count = (list || []).length;
  if (!count) return "";
  return `${count} record${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} approaching the 1 MB Firestore document limit. Past it the record stops saving altogether -- not just its history. The usual cause is the activity log, which lives inside the record.`;
};
