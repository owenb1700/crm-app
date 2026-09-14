import { getAdminDb, getAdminAuth } from "../../../../lib/firebaseAdmin";
import { alertAdmins } from "../../../../lib/adminAlert";

// The one piece of "delete a user" the client SDK can never do -- only the
// signed-in user can delete their own Firebase Auth account, so removing
// someone else's login has to happen here, with a service account. Every
// other part of a full delete (reassigning owned projects, stripping them
// from collaborator/tracked lists, removing their profile doc) is plain
// client-side Firestore writes an admin already has permission for, and
// stays in dashboard/page.js right next to the rest of admin user-management.
export async function POST(req) {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return Response.json({ error: "Missing auth token" }, { status: 401 });
  }

  const adminAuth = getAdminAuth();
  let callerUid;
  try {
    callerUid = (await adminAuth.verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: "Invalid or expired session -- refresh and try again" }, { status: 401 });
  }

  const db = getAdminDb();
  const callerSnap = await db.collection("users").doc(callerUid).get();
  if (!callerSnap.exists || callerSnap.data().role !== "admin") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const { uid } = await req.json();
  if (!uid) {
    return Response.json({ error: "Missing uid" }, { status: 400 });
  }
  if (uid === callerUid) {
    return Response.json({ error: "You can't delete your own account. Ask another admin to do it." }, { status: 400 });
  }

  try {
    await adminAuth.deleteUser(uid);
  } catch (err) {
    // Already gone from Auth isn't a failure -- the caller still needs to
    // finish cleaning up Firestore either way.
    if (err.code !== "auth/user-not-found") {
      const code = await alertAdmins({
        area: "Delete user",
        message: `Failed to delete the Auth account for uid ${uid}`,
        detail: err.message
      });
      return Response.json({ error: `Couldn't delete this account's login: ${err.message}`, code }, { status: 502 });
    }
  }

  return Response.json({ ok: true });
}
