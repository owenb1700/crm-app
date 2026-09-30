// What moving a pipeline entry to Post-Bid does.
//
// The bid is in; there's nothing to do for a while, but it shouldn't be
// forgotten either. So the entry keeps its place -- on the Pipeline list,
// and on My Projects for anyone who already had it -- and its next date is
// pushed out, where it comes back round for everyone on it.
//
// Post-Bid is normally reached by pressing Bids Sent on the entry rather
// than by picking the stage: that's the whole gap this exists for, the
// weeks between sending a number and hearing anything back.
//
// The stage lives on the entry itself, so one person changing it changes
// it for everyone; there's no per-person copy to keep in step.

export const BUDGETING_DESIGN = "Budgeting/Design";
export const PRE_BID = "Pre-Bid";
export const BIDDING = "Bidding";
export const POST_BID = "Post-Bid";

// In the order the work happens. Budgeting and Design were two names for
// the same early stage -- somebody is working up a number before there is
// anything to bid -- so they are one.
//
// Post-Bid is the end of this list on purpose. What comes after a bid is
// an answer, not a stage: the entry is won or lost, and a won one gets
// Convert to Project. Marching it further along a list would skip the
// question.
export const PIPELINE_STAGES = [BUDGETING_DESIGN, PRE_BID, BIDDING, POST_BID];

// Old names, so an entry written before the merge still reads correctly
// whether or not its stored value has been rewritten.
const RENAMED_STAGES = new Map([
  ["design", BUDGETING_DESIGN],
  ["budgeting", BUDGETING_DESIGN]
]);

export function normalizeStage(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return RENAMED_STAGES.get(text.toLowerCase()) || text;
}

export const stageNeedsMigrating = (value) =>
  RENAMED_STAGES.has(String(value || "").trim().toLowerCase());

export const pipelineStageIndex = (value) => PIPELINE_STAGES.indexOf(normalizeStage(value));

// One step along, or null at Post-Bid where the outcome takes over.
export function nextPipelineStage(value) {
  const i = pipelineStageIndex(value);
  if (i < 0) return null;
  return PIPELINE_STAGES[i + 1] || null;
}

export function nextPipelineStageLabel(value) {
  const to = nextPipelineStage(value);
  return to ? `Move to ${to}` : "";
}

// How long after sending a bid it's worth chasing. Two weeks -- long
// enough that nothing has happened, short enough to still be the job
// they remember talking to you about.
export const FOLLOW_UP_WEEKS = 2;

// Two weeks from today, landing on the Friday before if it falls on a
// weekend, same as every other date the app sets for itself.
export function postBidCheckIn(from = new Date()) {
  const next = new Date(from);
  next.setDate(next.getDate() + FOLLOW_UP_WEEKS * 7);
  if (next.getDay() === 6) next.setDate(next.getDate() - 1);
  if (next.getDay() === 0) next.setDate(next.getDate() - 2);
  const pad = n => String(n).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

// Only when it's newly Post-Bid -- re-saving an entry that's been there a
// while shouldn't keep shoving the date another month away.
export const movedToPostBid = (before, after) =>
  after?.stage === POST_BID && before?.stage !== POST_BID;
