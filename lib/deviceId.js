// A random id this browser keeps for itself, so the site can tell "the
// laptop that already passed a login code" from "somewhere new". It says
// nothing about the machine and isn't tied to the person -- the server
// only ever stores its hash.
//
// Clearing site data loses it, and the next sign-in asks for a code again.
// That's the right way round: forgetting is safe, remembering is what has
// to be earned.
const KEY = "crmDeviceId";

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private windows and locked-down browsers can refuse storage. A
    // one-off id still works for this sign-in; it just won't be remembered,
    // so this device will be asked for a code every time.
    return crypto.randomUUID();
  }
}
