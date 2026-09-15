import { getAdminDb, getAdminAuth } from "../../../lib/firebaseAdmin";
import { loadRecord, deleteProjectCompletely, deletePipelineCompletely } from "../../../lib/deleteRecord";
import { alertAdmins } from "../../../lib/adminAlert";

// Permanently deletes one project or pipeline entry, with full cleanup (see
// lib/deleteRecord.js). Admins can delete anything; otherwise only the
// record's own owner can, matching who could delete it before.
export async function POST(req) {
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return Response.json({ error: "Missing auth token" }, { status: 401 });
  }

  let callerUid;
  try {
    callerUid = (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: "Your session expired -- refresh the page and try again" }, { status: 401 });
  }

  const { kind, id } = await req.json();
  if (!["project", "pipeline"].includes(kind) || !id) {
    return Response.json({ error: "Missing or invalid record to delete" }, { status: 400 });
  }

  const db = getAdminDb();
  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.exists ? callerSnap.data() : null;
  if (!caller || caller.disabled) {
    return Response.json({ error: "No active account" }, { status: 403 });
  }

  const record = await loadRecord(kind, id);
  if (!record) {
    return Response.json({ error: "That record no longer exists" }, { status: 404 });
  }
  if (caller.role !== "admin" && record.data.ownerId !== callerUid) {
    return Response.json({ error: "Only an admin or the owner can delete this" }, { status: 403 });
  }

  try {
    const summary = kind === "project" ? await deleteProjectCompletely(id) : await deletePipelineCompletely(id);
    return Response.json({ ok: true, summary });
  } catch (err) {
    const code = await alertAdmins({
      area: "Delete record",
      message: `Failed to fully delete ${kind} ${id}`,
      detail: err.message
    });
    return Response.json({ error: `Couldn't finish deleting: ${err.message}`, code }, { status: 502 });
  }
}
