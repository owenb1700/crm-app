import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireActiveUser, withinRateLimit } from "../../../../lib/apiAuth";
import { isDeviceTrusted, issueLoginCode, needsLoginCode, CODE_TTL_MINUTES } from "../../../../lib/loginCodes";
import { sendRawEmail } from "../../../../lib/mailer";
import { renderEmail } from "../../../../lib/emailTemplate";

// Called the moment a password checks out, before anyone is let through.
// It answers one question -- does this person, on this machine, need a
// code? -- and if so puts one in their inbox.
//
// It runs behind a real signed-in token, so a code is only ever sent to
// someone who already got the password right; nobody can fill an admin's
// inbox with codes by guessing at the login screen.
export async function POST(req) {
  const caller = await requireActiveUser(req);
  if (caller.error) return Response.json({ error: caller.error }, { status: caller.status });

  const { uid, user } = caller;
  if (!needsLoginCode(user)) return Response.json({ needsCode: false });

  const { deviceId } = await req.json().catch(() => ({}));
  if (!deviceId) return Response.json({ error: "Missing device id" }, { status: 400 });

  const db = getAdminDb();
  if (await isDeviceTrusted(db, uid, deviceId)) return Response.json({ needsCode: false, trusted: true });

  if (!withinRateLimit(`login-code:${uid}`, { limit: 5, windowMs: 10 * 60_000 })) {
    return Response.json(
      { error: "Too many codes requested. Wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const code = await issueLoginCode(db, uid, { deviceId });
  const heading = "Your CRM login code";
  const bodyHtml = `
    <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.5;">
      Someone just signed in to the Bullock Logan CRM as <strong>${user.email}</strong> on a device we haven't seen before.
      Enter this code to finish signing in:
    </p>
    <p style="margin:0 0 18px;font-size:34px;letter-spacing:10px;font-weight:700;color:#0d1424;">${code}</p>
    <p style="margin:0 0 18px;font-size:13px;color:#6b7280;line-height:1.5;">
      The code works for ${CODE_TTL_MINUTES} minutes, and only on the device that asked for it.
      Once it's accepted, that device won't need a code again for 30 days.
    </p>
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      If this wasn't you, someone knows your password -- change it as soon as you can.
    </p>
  `;

  try {
    await sendRawEmail(user.email, heading, renderEmail({ heading, bodyHtml }));
  } catch (err) {
    return Response.json({ error: `Couldn't send your code: ${err.message}` }, { status: 502 });
  }

  return Response.json({ needsCode: true, email: user.email });
}
