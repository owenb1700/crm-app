// Where a signed-out visit to a deep link (a shared project, pipeline
// entry, or parts order) sends someone back to once they actually log in.
//
// Without this, following a shared link while signed out always lands on
// the generic dashboard after signing in -- the share is only useful the
// first time, while the session happens to still be alive. This is what
// makes a share link actually work as a share link: it survives the
// detour through the login page.
//
// Session-scoped on purpose: a stale pending redirect from days ago
// shouldn't hijack a normal, unrelated login.
const KEY = "postLoginRedirect";

export function rememberIntendedPath() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, `${window.location.pathname}${window.location.search}`);
  } catch {
    // Private windows and blocked site data both land here -- login just
    // falls back to the dashboard, same as today.
  }
}

export function takeIntendedPath() {
  if (typeof window === "undefined") return null;
  try {
    const path = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    // Only ever hand back a path within the app -- never an absolute URL,
    // which a crafted value here could otherwise use to bounce someone
    // off-site right after they authenticate.
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}
