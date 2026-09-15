// Who gets alerted about what -- one place for the calendar, All Alerts,
// and digest emails to agree on. No Firebase imports, so the server-side
// digest job can use it too.

// An open pipeline entry's bid date: its owner, salesperson, project point
// person, anyone who added it to their dashboard, and everyone in the
// Estimating Department. Nobody once it has an outcome or became a project.
export function isPipelineBidAlertFor(entry, uid, role) {
  if (!entry || entry.outcome || entry.convertedToProjectId || !entry.bidDate) return false;
  return (
    role === "estimating" ||
    entry.ownerId === uid ||
    entry.salespersonId === uid ||
    entry.projectPointPersonId === uid ||
    (entry.trackedByIds || []).includes(uid)
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
    entry.projectPointPersonId === uid
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
  if (project.ownerId === uid || (project.collaboratorIds || []).includes(uid)) return true;
  if (project.category === "Project Closed") return false;
  return !!project.sourcePipelineId && (role === "estimating" || project.projectPointPersonId === uid);
}
