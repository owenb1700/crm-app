import crypto from "crypto";

const COLLECTION = "passwordResetTokens";
const INITIAL_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

// A brand-new account's very first reset/setup link expires 48 hours after
// it's sent -- same as any time-boxed invite. Every link after that (an
// admin resend, or the person hitting "Forgot password?" themselves) never
// expires on its own; it stays valid until whichever link is actually used
// sets a new password. "First ever" is decided by whether any token has
// ever been issued for this uid, not by who's asking for it -- so an
// admin's resend and a self-service Forgot Password both land on the same
// rule automatically. Requesting a new link always supersedes whatever's
// still outstanding, so only the most recently sent email can ever work.
export async function issueResetToken(db, { uid, email }) {
  const col = db.collection(COLLECTION);

  const allSnap = await col.where("uid", "==", uid).get();
  const isFirstEver = allSnap.empty;

  await Promise.all(
    allSnap.docs
      .filter(d => !d.data().used)
      .map(d => d.ref.update({ used: true, supersededAt: new Date().toISOString() }))
  );

  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const kind = isFirstEver ? "initial" : "resend";
  const expiresAt = isFirstEver ? new Date(now.getTime() + INITIAL_TTL_MS).toISOString() : null;

  await col.doc(token).set({
    uid,
    email,
    createdAt: now.toISOString(),
    expiresAt,
    used: false,
    usedAt: null,
    kind
  });

  return { token, expiresAt, kind };
}

// Looks a token up and reports whether it can still be used, without
// consuming it -- the caller sets the new password and marks it used only
// once that actually succeeds.
export async function consumeResetToken(db, token) {
  const ref = db.collection(COLLECTION).doc(token);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: "not_found" };

  const data = snap.data();
  if (data.used) return { ok: false, reason: "used" };
  if (data.expiresAt && new Date(data.expiresAt) < new Date()) return { ok: false, reason: "expired" };

  return { ok: true, uid: data.uid, ref };
}
