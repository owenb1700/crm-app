import { getAdminDb, getAdminAuth } from "../../../lib/firebaseAdmin";
import { sendRawEmail } from "../../../lib/mailer";
import { buildDigestHtml } from "../../../lib/digest";
import { alertAdmins } from "../../../lib/adminAlert";

// "Send Test Digest Now" in User Settings. Builds the digest with the same
// code as the daily scheduled send (a 7-day window plus overdue items) and
// emails it to the signed-in user's own address -- only ever their own, so
// the caller is identified from their session, never from the request body.
export async function POST(req) {
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) {
    return Response.json({ error: "Missing auth token" }, { status: 401 });
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return Response.json({ error: "Test digests aren't set up on this server (FIREBASE_SERVICE_ACCOUNT_KEY is missing)" }, { status: 500 });
  }

  let uid;
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return Response.json({ error: "Your session expired -- refresh the page and try again" }, { status: 401 });
  }

  const db = getAdminDb();
  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.exists ? userSnap.data() : null;
  if (!user?.email || user.disabled) {
    return Response.json({ error: "No active account with an email address was found" }, { status: 403 });
  }

  const [customersSnap, pipelineSnap, remindersSnap] = await Promise.all([
    db.collection("customers").get(),
    db.collection("pipeline").get(),
    db.collection("reminders").where("userId", "==", uid).get()
  ]);

  const { html } = buildDigestHtml({
    customers: customersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    pipelineEntries: pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    reminders: remindersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    uid,
    daysAhead: 7,
    includeOverdue: true,
    intro: "Test send -- this is what your digest looks like with your data right now."
  });

  try {
    await sendRawEmail(user.email, "Your Upcoming Tasks (Test Digest)", html);
    return Response.json({ ok: true, email: user.email });
  } catch (err) {
    const code = await alertAdmins({ area: "Test digest", message: `Failed to send a test digest to ${user.email}`, detail: err.message });
    return Response.json({ error: `Failed to send: ${err.message}`, code }, { status: 502 });
  }
}
