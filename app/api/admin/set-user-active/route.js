import { getAdminAuth, getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireActiveUser } from "../../../../lib/apiAuth";
import { alertAdmins } from "../../../../lib/adminAlert";

// Deactivating someone has to stop them at the database, not just in the
// app: their sign-in is disabled and their existing sessions are revoked,
// so an old browser tab (or a direct API call with their token) can't keep
// reading data. Reactivating puts it all back.
export async function POST(req) {
  const caller = await requireActiveUser(req);
  if (caller.error) {
    return Response.json({ error: caller.error }, { status: caller.status });
  }
  if (caller.user.role !== "admin") {
    return Response.json({ error: "Only an admin can do that" }, { status: 403 });
  }

  const { uid, disabled } = await req.json();
  if (!uid || typeof disabled !== "boolean") {
    return Response.json({ error: "Missing the account or what to set it to" }, { status: 400 });
  }
  if (uid === caller.uid && disabled) {
    return Response.json({ error: "You can't deactivate your own account" }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    return Response.json({ error: "That account no longer exists" }, { status: 404 });
  }
  const email = snap.data().email;

  try {
    await ref.update({ disabled });

    // Mirrored to a publicly readable lookup so the signed-out Forgot
    // Password screen refuses disabled accounts too.
    if (disabled) {
      await db.collection("disabledEmails").doc(email).set({ disabled: true });
    } else {
      await db.collection("disabledEmails").doc(email).delete().catch(() => {});
    }

    const auth = getAdminAuth();
    await auth.updateUser(uid, { disabled });
    if (disabled) await auth.revokeRefreshTokens(uid);

    return Response.json({ ok: true, disabled });
  } catch (err) {
    const code = await alertAdmins({
      area: "Deactivate user",
      message: `Failed to ${disabled ? "deactivate" : "reactivate"} ${email}`,
      detail: err.message
    }).catch(() => null);
    return Response.json({ error: `Couldn't finish: ${err.message}`, code }, { status: 502 });
  }
}
