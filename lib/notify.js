import { addDoc, collection } from "firebase/firestore";
import { db } from "./firebase";
import { sameCompany } from "./companyMatch";
import { normalizeSplits } from "./splits";

// In-app alerts raised by one person's work landing on another's plate.
// Nothing here emails anyone: these show on the bell, where the rest of
// someone's alerts live.

export async function notifyUsers(userIds, { type, message, link }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  await Promise.all(ids.map(userId => addDoc(collection(db, "notifications"), {
    userId,
    type,
    message,
    link: link || null,
    read: false,
    createdAt: new Date().toISOString()
  }).catch(() => {})));
  return ids.length;
}

// Firms named on a pipeline entry: the engineering firm and every bidder.
export const firmsOnEntry = (entry) =>
  [entry?.company, ...((entry?.biddingCompanies || []).map(b => b?.company))].filter(Boolean);

// Who owns those firms in the Directory. A firm with an assigned
// salesperson means that person wants to know when it comes up.
export function firmOwnersFor(firmNames, companies) {
  const owners = new Map();
  (firmNames || []).forEach(name => {
    const firm = (companies || []).find(c => sameCompany(c.name, name));
    if (firm?.salespersonId) owners.set(firm.salespersonId, firm.name);
  });
  return owners; // salespersonId -> firm name
}

// Only firms that weren't already on the entry, so editing an entry
// doesn't re-alert everyone about firms that were there all along.
export function newlyAddedFirms(before, after) {
  const had = firmsOnEntry(before);
  return firmsOnEntry(after).filter(name => !had.some(old => sameCompany(old, name)));
}

// People added to a credit split since last save (they also become
// collaborators, which is handled by withSplitMembers where it's saved).
export function newSplitMembers(before, after) {
  const had = new Set(normalizeSplits(before?.splits).map(s => s.userId));
  return normalizeSplits(after?.splits)
    .map(s => s.userId)
    .filter(id => id && !had.has(id));
}
