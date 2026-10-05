import { normalizeStage } from "./pipelineStages";

// A record of how a job changed state -- not every keystroke. Equipment
// rows, phone numbers and bidder edits are left out on purpose; what's
// kept is the shape of the job: its status, stage, outcome, who owns it,
// and the kind of work it is.
//
// Notes keep their own separate history and are never folded in here.

const PROJECT_STATE = {
  category: "Stage",
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

// A pipeline stage is read through the same normaliser the rest of the app
// uses, so a log entry never names a stage nobody can see -- an entry
// stored as "Design" before Budgeting and Design became one stage reads
// "Budgeting/Design" here too, and re-saving it logs no change at all.
const readState = (field, value) => (field === "stage" ? normalizeStage(value) : value);

export function stateChanges(before, after, kind = "project", nameOf = (v) => v) {
  const fields = kind === "pipeline" ? PIPELINE_STATE : PROJECT_STATE;
  const isPerson = (field) => ["ownerId", "salespersonId", "projectPointPersonId"].includes(field);

  return Object.entries(fields)
    .map(([field, label]) => {
      if (!(field in (after || {}))) return null;
      const from = blank(readState(field, before?.[field]));
      const to = blank(readState(field, after?.[field]));
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

// A project's stage was labelled "Status" until 2026-10-05, and every log
// entry written before then has that word baked into its text -- the line
// is stored, not built from the field each time it's read. Rather than
// rewrite history, the reader translates: the entries say Stage like
// everything else now, and nothing was edited to make that true.
//
// Only the machine-written state lines are touched. A note that happens to
// begin "Status:" is somebody's own words and is left exactly as typed.
const RENAMED_IN_LOG = [[/^Status: /, "Stage: "]];

export function readActivityOutcome(entry) {
  const text = String(entry?.outcome || "");
  if (entry?.type !== "changed") return text;
  return RENAMED_IN_LOG.reduce((out, [from, to]) => out.replace(from, to), text);
}
