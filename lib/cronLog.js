import { getAdminDb } from "./firebaseAdmin";

// Vercel's free plan only keeps an hour of logs, so by the time anyone
// reads an alert email the evidence is gone. Every scheduled job writes
// what it did (or the error it hit, with its stack) here instead, where it
// keeps for 30 days and an admin can read it back.

export async function recordCronRun(job, result) {
  try {
    const db = getAdminDb();
    const startedAt = new Date().toISOString();
    await db.collection("cronRuns").doc(`${job}_${startedAt}`).set({
      job,
      startedAt,
      ok: !result.error,
      ...result
    });
    await pruneOldRuns(db);
  } catch (err) {
    // Logging the run must never be what breaks the run.
    console.error(`[cronLog] couldn't record the ${job} run:`, err);
  }
}

async function pruneOldRuns(db) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const old = await db
    .collection("cronRuns")
    .where("startedAt", "<", cutoff.toISOString())
    .limit(200)
    .get();
  await Promise.all(old.docs.map(d => d.ref.delete().catch(() => {})));
}
