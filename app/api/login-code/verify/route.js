import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { withinRateLimit } from "../../../../lib/apiAuth";
import { checkLoginCode, trustDevice, describeDevice, MAX_ATTEMPTS, TRUST_DAYS } from "../../../../lib/loginCodes";

// Checks the code and, if it's right, remembers the device for 30 days.
//
// There's no signed-in token here on purpose: the browser is signed out
// while it waits for the code, so nothing can be read or written in the
// meantime. What stands in for it is the code itself, which was only ever
// emailed after a correct password, only to the address on the account,
// and only for the one device that asked -- a code guessed from anywhere
// else is refused before the digits are even looked at.
const REASONS = {
  none: "That code has expired. Go back and sign in again to get a new one.",
  expired: "That code has expired. Go back and sign in again to get a new one.",
  locked: `Too many wrong tries. Sign in again to get a new code.`,
  wrong_device: "That code was sent for a different device. Sign in again from this one."
};

export async function POST(req) {
  const { email, code, deviceId } = await req.json().catch(() => ({}));
  if (!email || !code || !deviceId) {
    return Response.json({ error: "Missing email, code or device id" }, { status: 400 });
  }

  if (!withinRateLimit(`login-verify:${email}`, { limit: MAX_ATTEMPTS * 2, windowMs: 10 * 60_000 })) {
    return Response.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
  }

  const db = getAdminDb();
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  // Same answer whether or not the account exists, so this can't be used to
  // find out who has one.
  if (snap.empty) return Response.json({ error: REASONS.none }, { status: 400 });

  const uid = snap.docs[0].id;
  const result = await checkLoginCode(db, uid, { code, deviceId });

  if (!result.ok) {
    const message =
      REASONS[result.reason] ||
      `That code isn't right. ${result.left} ${result.left === 1 ? "try" : "tries"} left.`;
    return Response.json({ error: message }, { status: 400 });
  }

  const trustedUntil = await trustDevice(db, uid, deviceId, {
    label: describeDevice(req.headers.get("user-agent") || "")
  });

  return Response.json({ ok: true, trustedUntil, trustDays: TRUST_DAYS });
}
