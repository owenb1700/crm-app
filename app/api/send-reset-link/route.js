import { getAdminDb } from "../../../lib/firebaseAdmin";
import { issueResetToken } from "../../../lib/passwordReset";
import { sendRawEmail } from "../../../lib/mailer";
import { renderEmail } from "../../../lib/emailTemplate";
import { alertAdmins } from "../../../lib/adminAlert";

const BASE_URL = "https://crm-app-coral-five.vercel.app";

// The one place that sends a password set/reset link -- used by account
// creation (the very first link a new user gets), the login page's Forgot
// Password, and an admin's "Send Reset Link" button. All three just pass an
// email; account creation also passes newAccount, which is what gets the
// 48-hour window -- every other link has no expiration and stays valid
// until used. See lib/passwordReset.js.
export async function POST(req) {
  const { email, newAccount } = await req.json();
  if (!email) {
    return Response.json({ error: "Missing email" }, { status: 400 });
  }

  const db = getAdminDb();
  const usersSnap = await db.collection("users").where("email", "==", email).limit(1).get();

  if (usersSnap.empty) {
    // Don't reveal whether an account exists for this email -- same
    // response either way, same as a normal "check your inbox" flow.
    return Response.json({ ok: true });
  }

  const userDoc = usersSnap.docs[0];
  const user = userDoc.data();

  if (user.disabled) {
    return Response.json({ error: "This account has been disabled. Contact your admin." }, { status: 403 });
  }

  const { token, kind } = await issueResetToken(db, { uid: userDoc.id, email, newAccount: newAccount === true });
  const link = `${BASE_URL}/reset-password?token=${token}`;
  const isInitial = kind === "initial";

  const heading = isInitial ? "Set your CRM password" : "Reset your CRM password";
  const bodyHtml = `
    <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.5;">
      ${isInitial ? "An account was created for you on the Bullock Logan CRM. Click below to set your password." : "Click below to set a new password."}
    </p>
    <p style="margin:0 0 20px;">
      <a href="${link}" style="display:inline-block;background:#2f5f8a;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        ${isInitial ? "Set Password" : "Reset Password"}
      </a>
    </p>
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      ${isInitial ? "This link works for 48 hours." : "This link has no expiration -- it stays valid until it's used."}
      If you didn't expect this email, you can ignore it.
    </p>
  `;

  try {
    await sendRawEmail(email, heading, renderEmail({ heading, bodyHtml }));
    return Response.json({ ok: true, kind });
  } catch (err) {
    const code = await alertAdmins({
      area: "Password reset email",
      message: `Failed to send a ${kind} reset link to ${email}`,
      detail: err.message
    });
    return Response.json({ error: `Failed to send email: ${err.message}`, code }, { status: 502 });
  }
}
