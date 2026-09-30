// A reminder, and what happens to it once it's done.
//
// Completing one used to delete the document. That took the date, the
// note and the fact it ever existed with it -- so the calendar could
// never answer "when did I chase this?", which is exactly the question a
// calendar is for. A finished reminder is a record of work done, not
// rubbish to be taken out.
//
// Reminders are one document per person (`userId`), so they are private
// by construction: "remind everyone on this entry" writes one each rather
// than sharing a single row. Nothing here changes that -- a completed
// reminder is as private as it was while it was outstanding, and `setBy`
// still says who put it on your list if it wasn't you.

export const isDone = (reminder) => !!reminder?.completedAt;

export const isOpen = (reminder) => !!reminder && !reminder.completedAt;

export const openOnly = (reminders) => (reminders || []).filter(isOpen);

export const doneOnly = (reminders) => (reminders || []).filter(isDone);

// Marking one done, rather than deleting it. The day it was due stays
// exactly as it was -- that's where it belongs on the calendar -- and the
// day it was finished is recorded separately.
export const completedPayload = (uid, when = new Date()) => ({
  completedAt: when.toISOString(),
  completedBy: uid || null
});

export const reopenedPayload = () => ({ completedAt: null, completedBy: null });

// Which record a reminder was attached to, if any.
export const attachedTo = (reminder) => {
  if (reminder?.projectId) return { kind: "project", id: reminder.projectId };
  if (reminder?.pipelineId) return { kind: "pipeline", id: reminder.pipelineId };
  if (reminder?.partId) return { kind: "part", id: reminder.partId };
  return null;
};

export const isFor = (reminder, kind, id) => {
  const at = attachedTo(reminder);
  return !!at && at.kind === kind && at.id === id;
};

// A record's own reminders for one person, newest due first, so a project
// page can show what that person has been chasing on it -- open ones to
// act on, finished ones as a log of what was done and when.
export function remindersOnRecord(reminders, { kind, id, userId }) {
  return (reminders || [])
    .filter(r => r && (!userId || r.userId === userId) && isFor(r, kind, id))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// "Chased 12 Sep, done 14 Sep" -- what a finished reminder reads as in a
// list of what happened on a job.
export function describeDone(reminder) {
  if (!isDone(reminder)) return "";
  const due = String(reminder.date || "").slice(0, 10);
  const done = String(reminder.completedAt || "").slice(0, 10);
  if (!due) return `Completed ${done}`;
  return due === done ? `Due and completed ${done}` : `Due ${due}, completed ${done}`;
}
