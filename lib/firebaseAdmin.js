import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// Server-only: this is the one place in the app that reads/writes Firestore
// without a signed-in user, bypassing the security rules entirely via a
// service account. Only ever used from the cron route -- never imported by
// anything that runs in the browser. FIREBASE_SERVICE_ACCOUNT_KEY holds the
// full service account JSON (from Firebase Console -> Project Settings ->
// Service Accounts -> Generate new private key) as one JSON string.
export function getAdminApp() {
  const existing = getApps();
  if (existing.length) return existing[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured");
  }

  return initializeApp({
    credential: cert(JSON.parse(raw))
  });
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

// Server-only, same as getAdminDb -- lets a route create/delete Firebase
// Auth accounts and set passwords directly, bypassing the client SDK's
// "only the signed-in user can touch their own account" restriction.
export function getAdminAuth() {
  return getAuth(getAdminApp());
}
