import { getAdminDb, getAdminAuth } from "../../../lib/firebaseAdmin";
import { loadRecord, deleteProjectCompletely, deletePipelineCompletely, moveToTrash, restoreFromTrash } from "../../../lib/deleteRecord";
import { alertAdmins } from "../../../lib/adminAlert";

// Deleting a project or pipeline entry, in three steps:
// - "trash" (the default, from any Delete button): moves it to the Trash for
//   30 days. Admins can trash anything; otherwise only the record's owner.
// - "restore" / "purge" (from the Trash): brings it back, or deletes it for
//   good with full cleanup (see lib/deleteRecord.js). Admins can do either
//   to anything; otherwise only the person who trashed it.
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

  const { kind, id, action = "trash" } = await req.json();
  if (!["project", "pipeline"].includes(kind) || !id || !["trash", "restore", "purge"].includes(action)) {
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
  const isAdmin = caller.role === "admin";
  if (action === "trash") {
    if (!isAdmin && record.data.ownerId !== callerUid) {
      return Response.json({ error: "Only an admin or the owner can delete this" }, { status: 403 });
    }
  } else {
    if (!record.data.deletedAt) {
      return Response.json({ error: "That isn't in the trash" }, { status: 400 });
    }
    if (!isAdmin && record.data.deletedBy !== callerUid) {
      return Response.json({ error: "Only an admin or the person who deleted this can do that" }, { status: 403 });
    }
  }

  try {
    let summary;
    if (action === "trash") summary = await moveToTrash(kind, id, callerUid);
    else if (action === "restore") summary = await restoreFromTrash(kind, id);
    else summary = kind === "project" ? await deleteProjectCompletely(id) : await deletePipelineCompletely(id);
    return Response.json({ ok: true, summary });
  } catch (err) {
    const code = await alertAdmins({
      area: "Delete record",
      message: `Failed to ${action} ${kind} ${id}`,
      detail: err.message
    });
    return Response.json({ error: `Couldn't finish: ${err.message}`, code }, { status: 502 });
  }
}
