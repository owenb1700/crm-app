// What moving a pipeline entry to Post-Bid does.
//
// The bid is in; there's nothing to do for a while, but it shouldn't be
// forgotten either. So the entry keeps its place -- on the Pipeline list,
// and on My Projects for anyone who already had it -- and its next date is
// pushed a month out, where it comes back round for everyone on it.
//
// The stage lives on the entry itself, so one person changing it changes
// it for everyone; there's no per-person copy to keep in step.

export const POST_BID = "Post-Bid";

// A month from today, landing on the Friday before if it falls on a
// weekend, same as every other date the app sets for itself.
export function postBidCheckIn(from = new Date()) {
  const next = new Date(from);
  next.setMonth(next.getMonth() + 1);
  if (next.getDay() === 6) next.setDate(next.getDate() - 1);
  if (next.getDay() === 0) next.setDate(next.getDate() - 2);
  const pad = n => String(n).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

// Only when it's newly Post-Bid -- re-saving an entry that's been there a
// while shouldn't keep shoving the date another month away.
export const movedToPostBid = (before, after) =>
  after?.stage === POST_BID && before?.stage !== POST_BID;
