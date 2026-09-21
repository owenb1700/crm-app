// A record of how a job changed state -- not every keystroke. Equipment
// rows, phone numbers and bidder edits are left out on purpose; what's
// kept is the shape of the job: its status, stage, outcome, who owns it,
// and the kind of work it is.
//
// Notes keep their own separate history and are never folded in here.

const PROJECT_STATE = {
  category: "Status",
  closedOutcome: "Outcome",
  workType: "Work type",
  ownerId: "Owner"
};

const PIPELINE_STATE = {
  stage: "Stage",
  outcome: "Outcome",
  workType: "Work type",
  salespersonId: "Salesperson",
  projectPointPersonId: "Point person",
  ownerId: "Owner",
  convertedToProjectId: "Converted to a project"
};

const blank = (v) => (v === null || v === undefined || v === "" ? "" : String(v));

export function stateChanges(before, after, kind = "project", nameOf = (v) => v) {
  const fields = kind === "pipeline" ? PIPELINE_STATE : PROJECT_STATE;
  const isPerson = (field) => ["ownerId", "salespersonId", "projectPointPersonId"].includes(field);

  return Object.entries(fields)
    .map(([field, label]) => {
      if (!(field in (after || {}))) return null;
      const from = blank(before?.[field]);
      const to = blank(after?.[field]);
      if (from === to) return null;
      if (field === "convertedToProjectId") return to ? { field, label, text: "Converted to a project" } : null;
      const read = (v) => (!v ? "(none)" : isPerson(field) ? nameOf(v) : v);
      return { field, label, text: `${label}: ${read(from)} → ${read(to)}` };
    })
    .filter(Boolean);
}

export const activityEntry = ({ type = "changed", changes = [], notes = null, by, byName }) => ({
  type,
  outcome: changes.map(c => c.text).join("; "),
  notes,
  by,
  authorName: byName,
  timestamp: new Date().toISOString()
});

// Appends to whatever log the record already has, so nothing written
// before this existed is lost.
export const withActivity = (existingLog, entry) => [...(existingLog || []), entry];
