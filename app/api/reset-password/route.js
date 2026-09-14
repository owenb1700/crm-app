import { getAdminDb, getAdminAuth } from "../../../lib/firebaseAdmin";
import { consumeResetToken } from "../../../lib/passwordReset";
import { alertAdmins } from "../../../lib/adminAlert";

const ERROR_MESSAGES = {
  not_found: "This reset link isn't valid. Ask an admin to send you a new one.",
  used: "This reset link has already been used. Ask an admin to send you a new one.",
  expired: "This reset link has expired. Ask an admin to send you a new one."
};

// The other half of /api/send-reset-link: takes the token from that email's
// link plus a new password, and actually sets it via the Admin SDK (the
// client SDK has no way to set a password for an account no one's signed
// into yet). Public route -- reset-password/page.js hits this while signed
// out, same as the link itself is meant to work signed out.
export async function POST(req) {
  const { token, password } = await req.json();

  if (!token || !password) {
    return Response.json({ error: "Missing token or password" }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const db = getAdminDb();
  const result = await consumeResetToken(db, token);

  if (!result.ok) {
    return Response.json({ error: ERROR_MESSAGES[result.reason] || ERROR_MESSAGES.not_found }, { status: 400 });
  }

  try {
    await getAdminAuth().updateUser(result.uid, { password });
    await result.ref.update({ used: true, usedAt: new Date().toISOString() });
    return Response.json({ ok: true });
  } catch (err) {
    const code = await alertAdmins({
      area: "Password reset",
      message: `Failed to set a new password for uid ${result.uid}`,
      detail: err.message
    });
    return Response.json({ error: `Something went wrong setting your password: ${err.message}`, code }, { status: 502 });
  }
}
