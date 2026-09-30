// What stage a project is at.
//
// Pre-Bid and Prospecting were two names for the same thing -- a job
// being chased before there is anything to bid -- so they are one option
// now. Pipeline entries keep their own separate `stage` list, where
// Pre-Bid still means something different: that list is not this one.

export const PRE_BID = "Pre-Bid/Prospecting";

export const PROJECT_CATEGORIES = [
  PRE_BID,
  "Bidding",
  "Ongoing Project",
  "Order",
  "Project Closed"
];

// The two old values, kept so anything written before the merge still
// reads correctly. Records are migrated, but reading through this means
// the app is right whether or not a particular one has been -- including
// anything restored from a backup taken before the change.
const OLD_NAMES = new Set(["pre-bid", "prospecting"]);

export function normalizeCategory(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return OLD_NAMES.has(text.toLowerCase()) ? PRE_BID : text;
}

export const isPreBid = (value) => normalizeCategory(value) === PRE_BID;

// Whether a stored value still needs rewriting, for the migration.
export const needsMigrating = (value) => OLD_NAMES.has(String(value || "").trim().toLowerCase());
