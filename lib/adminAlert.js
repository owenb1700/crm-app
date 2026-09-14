import { getAdminDb } from "./firebaseAdmin";
import { sendRawEmail } from "./mailer";
import { renderEmail } from "./emailTemplate";

export function generateIncidentCode() {
  return (
    Date.now().toString(36).toUpperCase().slice(-4) +
    Math.random().toString(36).toUpperCase().slice(-4)
  );
}

// The one place any failure anywhere in the app (an email that wouldn't
// send, a reminder that wouldn't reactivate, etc.) goes to get surfaced
// instead of silently dropped. Emails every non-disabled admin with a
// short incident code and the raw error detail -- meant to be pasted
// straight back into a Claude Code session to dig into. Never throws: if
// Firestore or Gmail itself is unreachable, this just logs to the server
// console as the last resort so it can't take down whatever called it.
export async function alertAdmins({ area, message, detail }) {
  const code = generateIncidentCode();
  try {
    const db = getAdminDb();
    const usersSnap = await db.collection("users").where("role", "==", "admin").get();
    const admins = usersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.email && !a.disabled);

    const bodyHtml = `
      <p style="margin:0 0 16px;font-size:13px;color:#374151;">
        Incident code <strong style="font-family:monospace;background:#f3f4f6;padding:2px 6px;border-radius:4px;">${code}</strong>
        -- paste this code (or this whole email) back into Claude Code to look into it.
      </p>
      <p style="margin:0 0 12px;font-size:14px;color:#111827;font-weight:600;">${message}</p>
      ${detail ? `<pre style="background:#f3f4f6;padding:12px;border-radius:6px;color:#374151;white-space:pre-wrap;font-size:12px;font-family:monospace;margin:0;">${String(detail).slice(0, 4000)}</pre>` : ""}
    `;
    const html = renderEmail({
      heading: `Something failed: ${area}`,
      bodyHtml,
      footerNote: `Sent automatically ${new Date().toISOString()}`
    });

    await Promise.all(
      admins.map(a => sendRawEmail(a.email, `CRM Alert [${code}]: ${area}`, html).catch(() => {}))
    );
  } catch (err) {
    // If we can't even get the alert out (Firestore or Gmail both down),
    // there's nothing left to do but log it server-side.
    console.error(`[adminAlert] failed to deliver alert (code ${code}, area "${area}"):`, err);
  }
  return code;
}
