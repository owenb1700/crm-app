// Why we didn't bid a job.
//
// Almost every answer is one of two things, and typing them out longhand
// meant the same reason arrived spelled six ways -- useless for ever
// counting how often equipment was the problem versus price. The two
// common answers are buttons; anything else is "Other", and Other has to
// be written down, because "Other" on its own records nothing.
//
// What gets stored is still a plain `lostReason` string, so Past Projects,
// Analytics and the exports read it exactly as they did before.

export const OTHER = "Other";

export const DID_NOT_BID_REASONS = ["No equipment", "Price not competitive", OTHER];

export const isPreset = (choice) => DID_NOT_BID_REASONS.includes(choice) && choice !== OTHER;

// What to store for a given choice: the preset itself, or whatever was
// typed under Other.
export function didNotBidReason(choice, typed) {
  if (isPreset(choice)) return choice;
  if (choice === OTHER) return String(typed || "").trim();
  return "";
}

// The complaint to show, or "" when it's good to save.
export function didNotBidProblem(choice, typed) {
  if (!choice) return "Pick why we aren't bidding.";
  if (choice === OTHER && !String(typed || "").trim()) return "Say what the reason was.";
  return "";
}
