import crypto from "crypto";

// Server-only. A second step for admin logins: the password gets you as
// far as a six-digit code emailed to the address on the account, and only
// that code gets you in. Once a device has passed the check it's trusted
// for 30 days, so an admin isn't hunting through their inbox every
// morning -- but a device nobody has seen before always has to ask.
//
// Nothing here is stored in the clear. The code is kept as a hash, and a
// device is only ever known by the hash of the random id its browser
// keeps, so the database never holds anything that would let someone else
// sign in.

export const TRUST_DAYS = 30;
export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;

const CODES = "loginCodes";
const DEVICES = "trustedDevices";
const DAY_MS = 24 * 60 * 60 * 1000;

const sha = value => crypto.createHash("sha256").update(String(value)).digest("hex");

// Six digits, drawn the same way a key is -- not Math.random().
export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

// Constant-time compare so a wrong code takes the same time as a right
// one, whatever the digits are.
const sameHash = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// What a device is filed under. The browser never learns this; it only
// ever sends its own id and is told which row is its own.
export const deviceKey = deviceId => sha(deviceId);

const deviceRef = (db, uid, deviceId) =>
  db.collection("users").doc(uid).collection(DEVICES).doc(deviceKey(deviceId));

// Only admins are asked for a code. Everyone else signs in as they always
// have -- this is about the account that can change roles and see
// everything, not about making the whole company do more typing.
//
// The escape hatch: if the email relay ever goes down, no admin could get
// in at all, and there's nobody above them to fix it. Setting
// DISABLE_LOGIN_CODES=true in the Vercel environment turns the step off
// until the mail is working again. It's checked here, on the server, so
// it can't be flipped from a browser.
export const needsLoginCode = user =>
  process.env.DISABLE_LOGIN_CODES !== "true" && (user?.role || "") === "admin";

export async function isDeviceTrusted(db, uid, deviceId) {
  if (!deviceId) return false;
  const snap = await deviceRef(db, uid, deviceId).get();
  if (!snap.exists) return false;
  const until = snap.data().trustedUntil;
  if (!until || new Date(until) <= new Date()) return false;

  // Touched on every sign-in so the admin's device list shows real last-use
  // dates rather than the day it was first trusted.
  await snap.ref.update({ lastUsedAt: new Date().toISOString() }).catch(() => {});
  return true;
}

// The 30 days start now, on every fresh code -- a device that keeps being
// used keeps being trusted, one that goes quiet falls off on its own.
export async function trustDevice(db, uid, deviceId, { label } = {}) {
  const now = new Date();
  const trustedUntil = new Date(now.getTime() + TRUST_DAYS * DAY_MS).toISOString();
  await deviceRef(db, uid, deviceId).set(
    {
      trustedUntil,
      label: label || "Unknown device",
      trustedAt: now.toISOString(),
      lastUsedAt: now.toISOString()
    },
    { merge: true }
  );
  return trustedUntil;
}

// A code belongs to one person on one device: asking from a second browser
// issues a second code and retires the first, so a code read over someone's
// shoulder is no use anywhere but the machine that asked for it.
export async function issueLoginCode(db, uid, { deviceId }) {
  const code = newCode();
  const now = new Date();
  await db.collection(CODES).doc(uid).set({
    codeHash: sha(code),
    deviceHash: sha(deviceId),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    attempts: 0
  });
  return code;
}

// Reports whether the code is good without trusting the device -- the
// caller does that once it's satisfied, so a half-finished check leaves
// nothing behind.
export async function checkLoginCode(db, uid, { code, deviceId }) {
  const ref = db.collection(CODES).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: "none" };

  const data = snap.data();
  if (new Date(data.expiresAt) <= new Date()) {
    await ref.delete().catch(() => {});
    return { ok: false, reason: "expired" };
  }
  if ((data.attempts || 0) >= MAX_ATTEMPTS) {
    await ref.delete().catch(() => {});
    return { ok: false, reason: "locked" };
  }
  if (!sameHash(data.deviceHash, sha(deviceId))) return { ok: false, reason: "wrong_device" };

  if (!sameHash(data.codeHash, sha(String(code || "").trim()))) {
    const attempts = (data.attempts || 0) + 1;
    await ref.update({ attempts });
    if (attempts >= MAX_ATTEMPTS) {
      await ref.delete().catch(() => {});
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "wrong", left: MAX_ATTEMPTS - attempts };
  }

  // Used once, gone -- the same code can't be replayed.
  await ref.delete().catch(() => {});
  return { ok: true };
}

// What the admin sees on their account page, newest use first, with the
// ones that have quietly aged out already filtered away.
export async function listTrustedDevices(db, uid) {
  const snap = await db.collection("users").doc(uid).collection(DEVICES).get();
  const now = new Date();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.trustedUntil && new Date(d.trustedUntil) > now)
    .sort((a, b) => (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""));
}

export const forgetDevice = (db, uid, id) =>
  db.collection("users").doc(uid).collection(DEVICES).doc(id).delete();

// A readable name for the machine, from what the browser says it is. Only
// ever shown back to the person themselves, so it's a memory aid, not a
// fingerprint.
export function describeDevice(userAgent = "") {
  const ua = String(userAgent);
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" : "Browser";
  const system =
    /iPhone/.test(ua) ? "iPhone" :
    /iPad/.test(ua) ? "iPad" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X/.test(ua) ? "Mac" :
    /Windows/.test(ua) ? "Windows" :
    /Linux/.test(ua) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}
