import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireActiveUser } from "../../../../lib/apiAuth";
import { listTrustedDevices, forgetDevice, deviceKey } from "../../../../lib/loginCodes";

// The devices that can currently skip the login code, and a way to throw
// one off. Always your own and only your own -- the uid comes from the
// signed-in token, never from the request, so there's nothing to point at
// someone else's account. A laptop left in a taxi is off in one click.

export async function GET(req) {
  const caller = await requireActiveUser(req);
  if (caller.error) return Response.json({ error: caller.error }, { status: caller.status });

  // The browser knows its own id but not the hash it's filed under, so
  // the marking of "this one" happens here.
  const here = new URL(req.url).searchParams.get("deviceId");
  const devices = await listTrustedDevices(getAdminDb(), caller.uid);
  return Response.json({
    devices: devices.map(d => ({
      id: d.id,
      label: d.label,
      trustedUntil: d.trustedUntil,
      lastUsedAt: d.lastUsedAt,
      current: Boolean(here) && d.id === deviceKey(here)
    }))
  });
}

export async function DELETE(req) {
  const caller = await requireActiveUser(req);
  if (caller.error) return Response.json({ error: caller.error }, { status: caller.status });

  const { id } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: "Missing device id" }, { status: 400 });

  await forgetDevice(getAdminDb(), caller.uid, id);
  return Response.json({ ok: true });
}
