import { alertAdmins } from "../../../lib/adminAlert";

// Lets client-side code report a failure it can't itself email anyone
// about (it has no Gmail credentials -- only the server does) instead of
// swallowing it into a bare `catch {}`. Fire-and-forget from the caller's
// side; this always resolves ok so a broken alert can't cascade into a
// second visible error.
export async function POST(req) {
  const { area, message, detail } = await req.json();
  const code = await alertAdmins({
    area: area || "App",
    message: message || "Something failed",
    detail
  });
  return Response.json({ ok: true, code });
}
