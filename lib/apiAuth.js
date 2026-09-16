import { getAdminAuth, getAdminDb } from "./firebaseAdmin";

// Server-only. Every route that can act on someone's behalf -- or spend
// something, like sending email from the company's Gmail account -- checks
// the caller here first: a real, signed-in, still-active account.

export async function requireActiveUser(req) {
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { error: "Missing auth token", status: 401 };

  let uid;
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return { error: "Your session expired -- refresh the page and try again", status: 401 };
  }

  const snap = await getAdminDb().collection("users").doc(uid).get();
  const user = snap.exists ? snap.data() : null;
  if (!user || user.disabled) return { error: "No active account", status: 403 };

  return { uid, user };
}

// A rough ceiling on how often one account can hit a route. Serverless
// instances come and go, so this doesn't catch everything -- it's here to
// stop a runaway loop or a bored script, not a determined attacker.
const hits = new Map();

export function withinRateLimit(key, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 500) {
    // Keep the map from growing forever on a long-lived instance.
    [...hits.keys()].slice(0, 200).forEach(k => hits.delete(k));
  }
  return recent.length <= limit;
}
