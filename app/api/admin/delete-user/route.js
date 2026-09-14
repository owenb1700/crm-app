import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, getAdminAuth } from "../../../../lib/firebaseAdmin";
import { alertAdmins } from "../../../../lib/adminAlert";

// A full delete, not a deactivation. Runs entirely server-side because the
// Firestore rules deliberately don't let even an admin delete someone
// else's notifications or collaboration requests from the browser -- doing
// it client-side would delete the login and then fail halfway through the
// cleanup. Anything the person owned is reassigned to the admin doing the
// deleting (otherwise it'd be owned by a uid that no longer exists, and
// only an owner can edit a project), and they're stripped out of every
// collaborator / tracked-by / assigned list.
export async function POST(req) {
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return Response.json({ error: "Missing auth token" }, { status: 401 });
  }

  const adminAuth = getAdminAuth();
  let callerUid;
  try {
    callerUid = (await adminAuth.verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: "Your session expired -- refresh the page and try again" }, { status: 401 });
  }

  const db = getAdminDb();
  const callerSnap = await db.collection("users").doc(callerUid).get();
  if (!callerSnap.exists || callerSnap.data().role !== "admin" || callerSnap.data().disabled) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const { uid } = await req.json();
  if (!uid) {
    return Response.json({ error: "Missing uid" }, { status: 400 });
  }
  if (uid === callerUid) {
    return Response.json({ error: "You can't delete your own account. Ask another admin to do it." }, { status: 400 });
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const email = userSnap.exists ? userSnap.data().email : null;

  // Login first: once this succeeds the person can't sign back in, so a
  // failure in the cleanup below can't leave a working login behind.
  try {
    await adminAuth.deleteUser(uid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") {
      const code = await alertAdmins({ area: "Delete user", message: `Failed to delete the login for uid ${uid}`, detail: err.message });
      return Response.json({ error: `Couldn't delete this account's login: ${err.message}`, code }, { status: 502 });
    }
  }

  try {
    const [customersSnap, pipelineSnap, notifSnap, tokenSnap] = await Promise.all([
      db.collection("customers").get(),
      db.collection("pipeline").get(),
      db.collection("notifications").where("userId", "==", uid).get(),
      db.collection("passwordResetTokens").where("uid", "==", uid).get()
    ]);

    const writes = [];
    let reassignedProjects = 0;
    let reassignedPipeline = 0;

    customersSnap.docs.forEach(d => {
      const c = d.data();
      const patch = {};
      if (c.ownerId === uid) { patch.ownerId = callerUid; reassignedProjects++; }
      if ((c.collaboratorIds || []).includes(uid)) patch.collaboratorIds = FieldValue.arrayRemove(uid);
      if (Object.keys(patch).length) writes.push(d.ref.update(patch));
      // Collaboration requests are keyed by the requester's uid.
      writes.push(d.ref.collection("collabRequests").doc(uid).delete());
    });

    pipelineSnap.docs.forEach(d => {
      const p = d.data();
      const patch = {};
      if (p.ownerId === uid) { patch.ownerId = callerUid; reassignedPipeline++; }
      if ((p.trackedByIds || []).includes(uid)) patch.trackedByIds = FieldValue.arrayRemove(uid);
      if (p.salespersonId === uid) patch.salespersonId = null;
      if (p.projectPointPersonId === uid) patch.projectPointPersonId = null;
      if (Object.keys(patch).length) writes.push(d.ref.update(patch));
    });

    notifSnap.docs.forEach(d => writes.push(d.ref.delete()));
    tokenSnap.docs.forEach(d => writes.push(d.ref.delete()));
    if (email) writes.push(db.collection("disabledEmails").doc(email).delete());

    await Promise.all(writes);
    await userRef.delete();

    return Response.json({ ok: true, reassignedProjects, reassignedPipeline });
  } catch (err) {
    const code = await alertAdmins({
      area: "Delete user",
      message: `Login for uid ${uid} was deleted, but cleaning up their data failed partway through`,
      detail: err.message
    });
    return Response.json({ error: `Their login was deleted, but cleanup failed: ${err.message}`, code }, { status: 502 });
  }
}
