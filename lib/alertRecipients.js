import { hasShare } from "./splits";
import { POST_BID } from "./pipelineStages";

// Who gets alerted about what -- one place for the calendar, All Alerts,
// and digest emails to agree on. No Firebase imports, so the server-side
// digest job can use it too.

// An open pipeline entry's bid date: its owner, salesperson, project point
// person, the salesperson assigned to any of its bidders, anyone who added
// it to their dashboard, and everyone in the Estimating Department. Nobody
// once it has an outcome or became a project.
//
// A bid date is a question -- did we bid this? -- and it stops the moment
// the question is answered. Pressing Bids Sent answers it: the entry moves
// to Post-Bid and gets a next date two weeks out, and that date is the one
// that chases from then on. Leaving the passed bid date on the calendar as
// well meant a job you had already dealt with sat there overdue for weeks
// while you waited to hear, next to the check-in that was actually doing
// the work. `bidNeedsAnswer` has always stopped at Post-Bid; this is the
// same rule, in the place that draws the calendar.
export function isPipelineBidAlertFor(entry, uid, role, today = null) {
  if (!entry || entry.outcome || entry.convertedToProjectId || !entry.bidDate) return false;
  if (entry.stage === POST_BID) return false;
  // Snoozed: not answered, but not worth being asked about again yet.
  if (today && entry.bidSnoozedUntil && String(today).slice(0, 10) < String(entry.bidSnoozedUntil).slice(0, 10)) return false;

  // Nobody named as salesperson or point person: the bid is whoever
  // entered it to answer for, and nobody else. Alerting the whole
  // Estimating Department and every bidder's salesperson about a job with
  // no one on it makes it everybody's and therefore nobody's.
  if (!entry.salespersonId && !entry.projectPointPersonId) {
    return entry.ownerId === uid;
  }

  return (
    role === "estimating" ||
    entry.ownerId === uid ||
    entry.salespersonId === uid ||
    entry.projectPointPersonId === uid ||
    (entry.biddingCompanies || []).some(b => b.salespersonId === uid) ||
    (entry.trackedByIds || []).includes(uid) ||
    hasShare(entry, uid)
  );
}

// An open entry's own next date -- set when it moves to Post-Bid, so the
// bid isn't forgotten while it sits. Same people as its bid date.
export function isPipelineCheckInFor(entry, uid, role) {
  if (!entry || entry.outcome || entry.convertedToProjectId || !entry.nextCheckIn) return false;
  return (
    role === "estimating" ||
    entry.ownerId === uid ||
    entry.salespersonId === uid ||
    entry.projectPointPersonId === uid ||
    (entry.biddingCompanies || []).some(b => b.salespersonId === uid) ||
    (entry.trackedByIds || []).includes(uid) ||
    hasShare(entry, uid)
  );
}

// A won pipeline entry's follow-up before it's converted into a project:
// its owner, salesperson, project point person, and the Estimating
// Department, so a won job never sits unassigned.
export function isWonFollowUpFor(entry, uid, role) {
  if (!entry || entry.outcome !== "Won" || entry.convertedToProjectId || !entry.nextCheckIn) return false;
  return (
    role === "estimating" ||
    entry.ownerId === uid ||
    entry.salespersonId === uid ||
    entry.projectPointPersonId === uid ||
    hasShare(entry, uid)
  );
}

// A project's next check-in. Always its owner and collaborators. A project
// that came from a won pipeline entry also keeps the Estimating Department
// and the pipeline's project point person in the loop. A closed project's
// check-in (Project Closed outcome) is the owner's alone.
export function isProjectCheckInFor(project, uid, role) {
  if (!project || !project.nextCheckIn) return false;
  if (project.category === "Project Closed" && project.closedOutcome === "Closed") {
    return project.ownerId === uid;
  }
  if (project.ownerId === uid || (project.collaboratorIds || []).includes(uid) || hasShare(project, uid)) return true;
  if (project.category === "Project Closed") return false;
  return !!project.sourcePipelineId && (role === "estimating" || project.projectPointPersonId === uid);
}

// Equipment or a part that was due to ship and hasn't, or that should have
// landed by now. A job's lead time is its owner's and collaborators'
// business, the same people as its check-in; a parts request is whoever
// entered it, since parts belong to whoever is handling them.
//
// Unlike a check-in, these never reach the Estimating Department at large
// -- a late tower is the job's problem, not the department's.
export function isLeadTimeAlertFor(record, uid) {
  // Opt-in: a lead time is recorded for the history unless someone
  // deliberately asked to be told when it slips.
  if (!record || record.leadTimeAlerts !== true || !record.leadTime || record.deliveredOn) return false;
  return (
    record.ownerId === uid ||
    (record.collaboratorIds || []).includes(uid) ||
    hasShare(record, uid)
  );
}

export const isPartLeadTimeAlertFor = (part, uid) =>
  !!part && part.leadTimeAlerts === true && !!part.leadTime && !part.deliveredOn && part.ownerId === uid;

// Who a record BELONGS to, regardless of what state it's in.
//
// Everything above answers "should this chase me?", so each one bails out
// once a job is settled -- a lost bid shouldn't alert anybody. The
// calendar's history needs the other question: was this ever mine? A bid
// that was lost still happened on its date, and the point of keeping it
// there is being able to look back and see what was due that day.
export function wasMineOnPipeline(entry, uid, role) {
  if (!entry) return false;
  return (
    role === "estimating" ||
    entry.ownerId === uid ||
    entry.salespersonId === uid ||
    entry.projectPointPersonId === uid ||
    (entry.biddingCompanies || []).some(b => b.salespersonId === uid) ||
    (entry.trackedByIds || []).includes(uid) ||
    hasShare(entry, uid)
  );
}

export function wasMineOnProject(project, uid, role) {
  if (!project) return false;
  return (
    project.ownerId === uid ||
    (project.collaboratorIds || []).includes(uid) ||
    hasShare(project, uid) ||
    (!!project.sourcePipelineId && (role === "estimating" || project.projectPointPersonId === uid))
  );
}


// A bid date that has gone by with nothing said. The people who owe an
// answer are the salesperson and the point person; with neither set it
// falls to whoever entered it -- the same rule isPipelineBidAlertFor uses.
export function bidNeedsAnswer(entry, today) {
  if (!entry || entry.outcome || entry.convertedToProjectId || !entry.bidDate) return false;
  if (entry.stage === "Post-Bid") return false;
  return String(entry.bidDate).slice(0, 10) < String(today).slice(0, 10);
}

export function owesBidAnswer(entry) {
  const assigned = [entry?.salespersonId, entry?.projectPointPersonId]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  return assigned.length ? assigned : [entry?.ownerId].filter(Boolean);
}
