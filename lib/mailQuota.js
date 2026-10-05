// How close the day's sending is to Gmail's ceiling.
//
// A free Gmail account relays about 500 recipients in a rolling 24 hours.
// Go past it and Google stops the account sending for roughly a day --
// quietly. Digests, alert emails, login codes and password resets all go
// through the one relay, so they would all stop together, and the only
// sign would be the admin failure alerts, which are themselves email.
//
// Hence a count kept in Firestore rather than in memory: every send is a
// different serverless instance, and a counter in a variable would reset
// constantly and never see the day whole. One document per day, one
// atomic increment per recipient, so concurrent sends can't lose count.

export const GMAIL_DAILY_RECIPIENTS = 500;

// Far enough below the ceiling to leave a working day's room to react.
export const WARN_AT = 400;

export const mailDayKey = (now = new Date()) => now.toISOString().slice(0, 10);

// One send can name several recipients; the cap counts people, not
// messages.
export const recipientCount = (to) =>
  String(to || "").split(",").map(x => x.trim()).filter(Boolean).length || 1;

// Counts the send and says whether this is the one that crossed the line.
// Never throws: a counter that can't be written is not a reason to stop
// sending the company's mail.
export async function countSend(to, { now = new Date() } = {}) {
  const people = recipientCount(to);
  try {
    // Loaded here rather than at the top: the rules above are plain
    // arithmetic and shouldn't drag the admin SDK in just to be read.
    const { getAdminDb } = await import("./firebaseAdmin.js");
    const db = getAdminDb();
    const ref = db.collection("mailCounts").doc(mailDayKey(now));
    const after = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const before = snap.exists ? (snap.data().recipients || 0) : 0;
      const warned = snap.exists ? !!snap.data().warned : false;
      const total = before + people;
      // The warning is claimed inside the transaction, so with several
      // sends landing at once exactly one of them raises it.
      const claiming = !warned && total >= WARN_AT;
      tx.set(ref, {
        recipients: total,
        warned: warned || claiming,
        updatedAt: now.toISOString()
      }, { merge: true });
      return { total, crossed: claiming };
    });
    return after;
  } catch (err) {
    // Sending carries on -- a counter is not worth losing the company's
    // mail over. But it says so: a counter that silently stops counting
    // looks exactly like a quiet day, right up until Gmail cuts the
    // account off with no warning at all.
    console.error("[mailQuota] couldn't count a send:", err?.message || err);
    return { total: null, crossed: false, countFailed: true };
  }
}

export const quotaWarning = (total) =>
  `${total} of about ${GMAIL_DAILY_RECIPIENTS} daily email recipients used. Gmail stops the account sending for roughly 24 hours past that ceiling, which would take digests, alert emails, login codes and password resets with it.`;
