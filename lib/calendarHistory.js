// What already happened, for the weeks behind today.
//
// The calendar used to be a to-do list: only things still outstanding,
// and anything overdue dragged onto today so it couldn't sit in a week
// nobody could scroll to. Now that it steps backwards, a past week should
// show what was actually on it -- the bid that was due, the job that was
// won, the project that closed -- not nothing at all.
//
// These are read-only markers. Nothing here is chased or completed; it's
// a record.

const day = (v) => {
  if (!v) return "";
  if (v?.seconds) return new Date(v.seconds * 1000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

// An entry we decided not to bid is business that never happened. It is
// filed in Past Projects and that is where it stops -- the day we passed
// on it isn't work anybody did, and putting it on a calendar square is
// noise in among the things that were real.
const DECLINED = "Did Not Bid";
export const wasDeclined = (record) => record?.outcome === DECLINED;

// Activity entries worth a square of their own. A status change or an
// owner swap is real history but it isn't an event anybody looks back
// for, so those stay on the record's own page.
// A status change or an owner swap is real history but not an event
// anybody looks back for, so those stay on the record's own page.
// "handled" is a check-in that was pushed, snoozed or answered -- it
// plots on the day it was due, so snoozing something doesn't wipe it off
// the week it was on.
const PLOTTED_ACTIVITY = new Set(["completed", "converted", "handled"]);

// A bid date stays on the calendar after it has passed, marked by what
// came of it. The point is being able to look at a date and see what was
// due that day -- which stops being possible if resolved work disappears.
export function resolvedBidItems(pipelineEntries, isForMe) {
  return (pipelineEntries || [])
    .filter(p => p.bidDate && p.outcome && !wasDeclined(p) && isForMe(p))
    .map(p => ({
      ...p,
      _kind: "bid",
      _done: true,
      _historyLabel: p.outcome,
      projectName: p.title,
      nextCheckIn: day(p.bidDate)
    }));
}

// The day a pipeline entry was settled, and the day a project closed.
export function outcomeItems(pipelineEntries, customers, isPipelineForMe, isProjectForMe) {
  const resolved = (pipelineEntries || [])
    .filter(p => p.resolvedAt && p.outcome && !wasDeclined(p) && isPipelineForMe(p))
    .map(p => ({
      ...p,
      _kind: "outcome",
      _done: true,
      _historyLabel: p.outcome,
      projectName: p.title,
      nextCheckIn: day(p.resolvedAt)
    }));

  const closed = (customers || [])
    .filter(c => c.closedAt && isProjectForMe(c))
    .map(c => ({
      ...c,
      _kind: "outcome",
      _done: true,
      _historyLabel: c.closedOutcome || "Closed",
      projectName: c.projectName || c.company,
      nextCheckIn: day(c.closedAt)
    }));

  return [...resolved, ...closed];
}

// Anything logged on a record: when it was completed, when it became a
// project. Each entry carries the day it happened, which is what puts it
// on a square.
export function activityItems(records, isForMe, kindName) {
  const out = [];
  (records || []).forEach(record => {
    if (!isForMe(record) || wasDeclined(record)) return;
    (record.activityLog || []).forEach((entry, i) => {
      if (!PLOTTED_ACTIVITY.has(entry?.type) || !entry?.timestamp) return;
      out.push({
        ...record,
        id: `${record.id}-activity-${i}`,
        _recordId: record.id,
        _kind: kindName,
        _done: true,
        _historyLabel: entry.outcome || entry.type,
        projectName: record.projectName || record.title || record.company,
        // A check-in that was pushed or snoozed belongs on the day it was
        // due, not the day somebody moved it. Moving it is the admin; the
        // due date is the history. `onDate` says which day the entry is
        // about when that differs from when it was written.
        nextCheckIn: day(entry.onDate || entry.timestamp)
      });
    });
  });
  return out;
}

// Ship and delivery dates, but only for records whose owner asked to be
// told about them. A lead time is usually recorded and never chased --
// putting every one of them on the calendar would bury the work someone
// actually has to do.
export function leadTimeItems(records, isForMe, statusOf) {
  return (records || [])
    .filter(r => r.leadTimeAlerts === true && r.leadTime && !wasDeclined(r) && isForMe(r))
    .map(r => {
      const status = statusOf(r);
      const date = status?.shipDate || "";
      if (!date) return null;
      return {
        ...r,
        id: `${r.id}-ship`,
        _recordId: r.id,
        _kind: "ship",
        _done: !!r.shippedOn,
        _historyLabel: r.shippedOn ? `Shipped ${day(r.shippedOn)}` : "Due to ship",
        projectName: r.projectName || r.title || r.item || r.company,
        nextCheckIn: date
      };
    })
    .filter(Boolean);
}

// Reminders that have been dealt with, on the day they were due rather
// than the day they were ticked off. The calendar's job is to answer
// "what was on the 12th?", and the answer includes the thing you chased
// and finished -- otherwise a busy week reads as an empty one in
// hindsight.
export function doneReminderItems(reminders, isForMe = () => true) {
  return (reminders || [])
    .filter(r => r && r.completedAt && r.date && isForMe(r))
    .map(r => ({
      ...r,
      _kind: "reminder",
      _done: true,
      _historyLabel: "Completed",
      projectName: r.subject,
      nextCheckIn: day(r.date)
    }));
}

// One record can produce several markers -- a bid date, the day it was
// won, the log entry for that same win. Keep one per record per day per
// kind so a square doesn't repeat itself.
export function dedupeByDay(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = `${item._recordId || item.id}-${item._kind}-${item.nextCheckIn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
