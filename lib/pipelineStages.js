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

export const POST_BID = "Post-Bid";

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
