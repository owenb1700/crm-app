import { alertAdmins } from "../../../lib/adminAlert";
import { requireActiveUser, withinRateLimit } from "../../../lib/apiAuth";

// Lets client-side code report a failure it can't itself email anyone
// about (it has no Gmail credentials -- only the server does) instead of
// swallowing it into a bare `catch {}`. Fire-and-forget from the caller's
// side; this always resolves ok so a broken alert can't cascade into a
// second visible error.
export async function POST(req) {
  // Signed-in callers only, and not too often: otherwise anyone could fill
  // every admin's inbox from outside the app. Failures here are reported
  // as ok so a broken alert never cascades into a second visible error.
  const caller = await requireActiveUser(req);
  if (caller.error) {
    return Response.json({ ok: false, skipped: caller.error });
  }
  if (!withinRateLimit(`report-issue:${caller.uid}`, { limit: 10, windowMs: 60_000 })) {
    return Response.json({ ok: false, skipped: "Rate limited" });
  }

  const { area, message, detail } = await req.json();
  const code = await alertAdmins({
    area: area || "App",
    message: message || "Something failed",
    detail
  });
  return Response.json({ ok: true, code });
}
