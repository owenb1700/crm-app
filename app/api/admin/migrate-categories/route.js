import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireActiveUser } from "../../../../lib/apiAuth";
import { planAll, summarize, migrationLogEntry } from "../../../../lib/categoryMigration";

// Bringing stored project statuses in line after the rename.
//
// It runs here rather than from a laptop because this is where the
// production service-account key lives -- it is a sensitive Vercel
// variable and can't be pulled down, so a local script could only ever
// reach staging.
//
// GET is a dry run: it reports exactly what would change and writes
// nothing. POST applies it. Both are admin-only, and the work is
// idempotent, so running it twice is harmless.

async function load(db) {
  const snap = await db.collection("customers").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function guard(req) {
  const caller = await requireActiveUser(req);
  if (caller.error) return { response: Response.json({ error: caller.error }, { status: caller.status }) };
  if (caller.user.role !== "admin") {
    return { response: Response.json({ error: "Only an admin can run a migration" }, { status: 403 }) };
  }
  return { caller };
}

export async function GET(req) {
  const { response } = await guard(req);
  if (response) return response;

  const plans = planAll(await load(getAdminDb()));
  return Response.json({
    dryRun: true,
    ...summarize(plans),
    records: plans.map(p => ({ name: p.name, from: p.from, to: p.to }))
  });
}

export async function POST(req) {
  const { response } = await guard(req);
  if (response) return response;

  const db = getAdminDb();
  const plans = planAll(await load(db));
  if (!plans.length) return Response.json({ applied: 0, ...summarize(plans), alreadyDone: true });

  // Firestore caps a batch at 500 writes; these are small and there is no
  // reason to hold them all open at once.
  const CHUNK = 200;
  let applied = 0;
  for (let i = 0; i < plans.length; i += CHUNK) {
    const batch = db.batch();
    for (const p of plans.slice(i, i + CHUNK)) {
      const ref = db.collection("customers").doc(p.id);
      // Read the log fresh so an entry written between the plan and the
      // write isn't dropped.
      const current = await ref.get();
      const log = current.exists ? (current.data().activityLog || []) : [];
      batch.update(ref, {
        category: p.to,
        activityLog: [...log, migrationLogEntry(p.from, p.to)]
      });
    }
    await batch.commit();
    applied += Math.min(CHUNK, plans.length - i);
  }

  return Response.json({ applied, ...summarize(plans) });
}
