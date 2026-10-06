import { getStorage } from "firebase-admin/storage";
import { getAdminDb, getAdminApp } from "../../../../lib/firebaseAdmin";
import { alertAdmins } from "../../../../lib/adminAlert";
import { recordCronRun } from "../../../../lib/cronLog";
import { oversizedRecords, describeOversized, oversizedSummary, estimateBytes } from "../../../../lib/recordSize";
import { recordGrowth } from "../../../../lib/growthLog.server";

// Nightly safety copy of everything in the database, written to Storage as
// JSON (backups/YYYY-MM-DD/<collection>.json). The Trash only covers whole
// projects and pipeline entries for 30 days; this covers the rest -- the
// Directory, reminders, users, notes, photos' details -- and can be read
// back by hand if something goes badly wrong.

const COLLECTIONS = [
  "users", "customers", "pipeline", "parts", "companies", "contacts", "companyKeys",
  "products", "towerModels", "reminders", "notifications", "duplicateDismissals", "disabledEmails",
  "cronRuns"
];

// Subcollections worth keeping: a project's notes and drawings, a pipeline
// entry's notes and files, and both of their photo details.
// Notes live in their own documents now (one per note), so they only get
// backed up if they're listed here -- they're not fields on the record.
const SUBCOLLECTIONS = {
  customers: ["private", "notes", "drawings", "photos", "collabRequests"],
  pipeline: ["private", "teamNotes", "myNotes", "photos"],
  parts: ["notes"],
  contacts: ["notes"]
};

const KEEP_DAYS = 30;

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    return Response.json({ error: "No storage bucket configured" }, { status: 500 });
  }
  const bucket = getStorage(getAdminApp()).bucket(bucketName);
  const stamp = new Date().toISOString().slice(0, 10);
  const counts = {};

  // Records creeping up on the 1 MB document ceiling. Collected while the
  // backup is reading everything anyway, so it costs no extra reads.
  const tooBig = [];
  let biggestBytes = 0;

  try {
    for (const name of COLLECTIONS) {
      const snap = await db.collection(name).get();
      const docs = [];
      for (const d of snap.docs) {
        const record = { id: d.id, ...d.data() };
        // Measured before the subcollections are folded in below: what
        // matters is the size of the Firestore document itself, not the
        // size of the backup blob we are about to write.
        if (name === "customers" || name === "pipeline") {
          tooBig.push(...oversizedRecords([record], { kind: name === "customers" ? "project" : "pipeline entry" }));
          biggestBytes = Math.max(biggestBytes, estimateBytes(record));
        }
        for (const sub of SUBCOLLECTIONS[name] || []) {
          const subSnap = await d.ref.collection(sub).get();
          if (!subSnap.empty) {
            record[`_${sub}`] = subSnap.docs.map(x => ({ id: x.id, ...x.data() }));
          }
        }
        docs.push(record);
      }
      counts[name] = docs.length;
      await bucket.file(`backups/${stamp}/${name}.json`).save(JSON.stringify(docs), {
        contentType: "application/json",
        resumable: false
      });
    }

    await bucket.file(`backups/${stamp}/summary.json`).save(
      JSON.stringify({ takenAt: new Date().toISOString(), counts }),
      { contentType: "application/json", resumable: false }
    );

    // Older copies are cleared out so backups don't pile up forever.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    const cutoffStamp = cutoff.toISOString().slice(0, 10);
    const [files] = await bucket.getFiles({ prefix: "backups/" });
    const stale = files.filter(f => {
      const day = f.name.split("/")[1] || "";
      return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoffStamp;
    });
    await Promise.all(stale.map(f => f.delete().catch(() => {})));

    // The counts are already in hand, so keeping them costs one small
    // write and no extra reads. cronRuns is culled after 30 days; this is
    // the copy that outlives it.
    await recordGrowth(counts, { biggestBytes });

    // Said once a night, and only when something is actually close. The
    // backup itself carries on either way -- a warning is not a failure.
    if (tooBig.length) {
      await alertAdmins({
        area: "Records approaching the size limit",
        message: oversizedSummary(tooBig),
        detail: `${describeOversized(tooBig)}\n\nThe fix is to move that record's activity log into its own subcollection, the way notes already are. Nothing is broken yet -- this is notice, not an outage.`
      });
    }

    await recordCronRun("backup", { date: stamp, counts, removedOldFiles: stale.length, nearSizeLimit: tooBig.length });
    return Response.json({ ok: true, date: stamp, counts, removedOldFiles: stale.length, nearSizeLimit: tooBig.length });
  } catch (err) {
    const code = await alertAdmins({
      area: "Backup",
      message: "The nightly database backup failed",
      detail: `${err.message}\n\n${err.stack || ""}`
    }).catch(() => null);
    await recordCronRun("backup", { error: err.message, stack: err.stack || null, code });
    return Response.json({ error: `Backup failed: ${err.message}`, code }, { status: 502 });
  }
}
