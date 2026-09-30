// The stages a project moves through, and what it takes to move.
//
// A job starts as something being chased, becomes a bid, goes out, is won
// or lost, and if won becomes work. That order was never written down --
// the status was a free dropdown, so a job could jump from Pre-Bid to
// Ongoing without anyone saying whether it had been won, and nothing
// recorded that it had been.
//
// This mirrors the pipeline: bids go out, then somebody has to say what
// came of them. Won moves it on and says so; lost closes it and asks why,
// and who to if that's known.
//
// Pipeline entries keep their own separate `stage` list. Pre-Bid there
// means something different; that list is not this one.

export const PRE_BID = "Pre-Bid/Prospecting";
export const BIDDING = "Bidding";
export const BIDS_SENT = "Post-Bid/Bids Sent";
export const UNDER_CONTRACT = "Under Contract/Ordered";
export const ONGOING = "Ongoing Project";
export const CLOSED = "Project Closed";

// In the order work actually happens.
export const PROJECT_CATEGORIES = [PRE_BID, BIDDING, BIDS_SENT, UNDER_CONTRACT, ONGOING, CLOSED];

// Old names, so anything written before this reads correctly whether or
// not it has been migrated -- including a record restored from an older
// backup. "Order" was what Under Contract/Ordered used to be called.
const RENAMED = new Map([
  ["pre-bid", PRE_BID],
  ["prospecting", PRE_BID],
  ["order", UNDER_CONTRACT]
]);

export function normalizeCategory(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return RENAMED.get(text.toLowerCase()) || text;
}

export const isPreBid = (value) => normalizeCategory(value) === PRE_BID;
export const isClosed = (value) => normalizeCategory(value) === CLOSED;
export const needsMigrating = (value) => RENAMED.has(String(value || "").trim().toLowerCase());

export const stageIndex = (value) => PROJECT_CATEGORIES.indexOf(normalizeCategory(value));

// The one step forward from here, or null at the end of the road. A
// status nobody recognises has no next step either -- guessing one would
// be worse than leaving it be.
export function nextStage(value) {
  const i = stageIndex(value);
  if (i < 0) return null;
  return PROJECT_CATEGORIES[i + 1] || null;
}

// What the button offers to do. Closing gets its own wording because it
// is the one step that ends the job rather than advancing it.
export function nextStageLabel(value) {
  const to = nextStage(value);
  if (!to) return "";
  return to === CLOSED ? "Close out the project" : `Move to ${to}`;
}

// Leaving Bids Sent means the bid was answered, and the answer is what
// decides where it goes. Closing is always allowed -- jobs die at every
// stage, for reasons that have nothing to do with the bid.
export function needsOutcome(from, to) {
  const a = normalizeCategory(from);
  const b = normalizeCategory(to);
  if (a !== BIDS_SENT) return false;
  if (b === CLOSED || b === BIDS_SENT) return false;
  return stageIndex(b) > stageIndex(BIDS_SENT);
}

// Where marking it won or lost puts the job.
export const afterWon = () => UNDER_CONTRACT;
export const afterLost = () => CLOSED;

export const wonNote = (contractor) =>
  contractor ? `Job won — awarded to ${contractor}` : "Job won";

export function lostNote(reason, lostTo) {
  const why = String(reason || "").trim();
  const who = String(lostTo || "").trim();
  const parts = ["Job lost"];
  if (who) parts.push(`to ${who}`);
  return why ? `${parts.join(" ")} — ${why}` : parts.join(" ");
}

// What's wrong with marking it lost, or "" when it's good to save.
export function lostProblem(reason) {
  return String(reason || "").trim() ? "" : "Say why the job was lost.";
}

// Closing always needs a reason too. A job that stops has a reason -- the
// building sold, the money went, it was shelved -- and a year later
// "Project Closed" on its own tells nobody which. Losing a bid is the one
// case already covered, because that path asks its own question.
export function closeProblem(reason) {
  return String(reason || "").trim() ? "" : "Say why this is closing.";
}

export const closeNote = (reason) => {
  const why = String(reason || "").trim();
  return why ? `Project closed — ${why}` : "Project closed";
};
