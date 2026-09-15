import { getAdminDb, getAdminAuth } from "../../../lib/firebaseAdmin";
import { mergeCompanies, mergePeople, renameCompany, syncCompanyKeys } from "../../../lib/directoryRecords";
import { alertAdmins } from "../../../lib/adminAlert";

// Directory maintenance that has to touch many records at once:
// - renameCompany (anyone): renames a firm and every project / pipeline
//   entry that names it.
// - mergeCompanies, mergePeople, syncKeys, dismissGroup (admins only): the
//   Find Duplicates screen.
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

  const db = getAdminDb();
  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.exists ? callerSnap.data() : null;
  if (!caller || caller.disabled) {
    return Response.json({ error: "No active account" }, { status: 403 });
  }

  const body = await req.json();
  const { action } = body;
  const adminOnly = ["mergeCompanies", "mergePeople", "syncKeys", "dismissGroup"];
  if (![...adminOnly, "renameCompany"].includes(action)) {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  if (adminOnly.includes(action) && caller.role !== "admin") {
    return Response.json({ error: "Only an admin can do that" }, { status: 403 });
  }

  try {
    let result;
    if (action === "renameCompany") {
      result = await renameCompany({ companyId: body.companyId, name: body.name });
    } else if (action === "mergeCompanies" || action === "mergePeople") {
      const mergeIds = (body.mergeIds || []).filter(id => id && id !== body.keepId);
      if (!body.keepId || !mergeIds.length) {
        return Response.json({ error: "Pick what to keep and what to merge into it" }, { status: 400 });
      }
      result = action === "mergeCompanies"
        ? await mergeCompanies({ keepId: body.keepId, mergeIds })
        : await mergePeople({ keepId: body.keepId, mergeIds });
    } else if (action === "syncKeys") {
      result = await syncCompanyKeys();
    } else {
      if (!body.groupId) return Response.json({ error: "Missing group" }, { status: 400 });
      await db.collection("duplicateDismissals").doc(body.groupId.replace(/\//g, "_").slice(0, 1400)).set({
        groupId: body.groupId,
        kind: body.kind === "people" ? "people" : "companies",
        dismissedBy: callerUid,
        dismissedAt: new Date().toISOString()
      });
      result = { dismissed: true };
    }
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err.status === 409) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    const code = await alertAdmins({ area: "Directory", message: `Directory ${action} failed`, detail: err.message }).catch(() => null);
    return Response.json({ error: `Couldn't finish: ${err.message}`, code }, { status: 502 });
  }
}
