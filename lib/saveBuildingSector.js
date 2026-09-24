"use client";

import { collection, doc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { SECTOR_COLLECTION, sectorKey, sectorUpdatesForFirms, sectorLogLine } from "./buildingSectors";
import { activityEntry, withActivity } from "./activityLog";

// Saving a building's sector does two things at once: it records the
// sector against the address, and it tells every firm that has worked
// there that it does that kind of work.
//
// The second half is the point. Nobody is going to keep a list of which
// contractors have done hospitals; the work already says so, and this
// writes it down where it can be searched later.
export async function saveBuildingSector({ label, sectors, uid, userName }) {
  const key = sectorKey(label);
  if (!key) throw new Error("That address can't be saved without a street address.");

  const wanted = [...new Set((sectors || []).filter(Boolean))].sort();
  await setDoc(
    doc(db, SECTOR_COLLECTION, key),
    {
      key,
      label: String(label || "").trim(),
      sectors: wanted,
      updatedAt: new Date().toISOString(),
      updatedBy: uid || null
    },
    { merge: true }
  );

  return { key, sectors: wanted };
}

// Push a building's sectors onto the firms that have worked there.
// Returns what it changed so the page can say so out loud rather than
// altering company records invisibly.
export async function teachFirmsAboutSectors({ firmNames, sectors, addressLabel, uid, userName }) {
  const wanted = (sectors || []).filter(Boolean);
  if (!wanted.length || !(firmNames || []).length) return [];

  const snap = await getDocs(collection(db, "companies"));
  const companies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const updates = sectorUpdatesForFirms(firmNames, wanted, companies);

  for (const update of updates) {
    const firm = companies.find(c => c.id === update.id);
    // Logged on the firm itself, because a sector appearing on a company
    // nobody opened should still be explainable months later.
    await updateDoc(doc(db, "companies", update.id), {
      sectors: update.sectors,
      activityLog: withActivity(firm?.activityLog, activityEntry({
        type: "changed",
        changes: [sectorLogLine(update.add, addressLabel)],
        by: uid || null,
        byName: userName || "Someone"
      }))
    });
  }

  return updates;
}
