import { getAdminDb } from "./firebaseAdmin.js";
import { monthKey, dayKey, totalRecords, dashboardReadsPerLoad, GROWTH_COLLECTION } from "./growthLog.js";

// Server-only: writes the nightly reading. Kept apart from the helpers the
// dashboard reads, so the admin SDK never reaches the browser bundle.

// One document a month, each day merged into it. Never throws: a missing
// measurement is not worth failing a backup over.
export async function recordGrowth(counts, { biggestBytes = 0, now = new Date() } = {}) {
  try {
    await getAdminDb()
      .collection(GROWTH_COLLECTION)
      .doc(monthKey(now))
      .set({
        month: monthKey(now),
        days: {
          [dayKey(now)]: {
            counts,
            totalRecords: totalRecords(counts),
            readsPerDashboardLoad: dashboardReadsPerLoad(counts),
            biggestBytes
          }
        }
      }, { merge: true });
    return true;
  } catch (err) {
    console.error("[growthLog] couldn't record today's counts:", err?.message || err);
    return false;
  }
}

