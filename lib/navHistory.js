// Where "Back" actually goes.
//
// Every Back button used to name a fixed destination -- a pipeline entry
// always said "Back to Pipeline" even when you'd opened it from My
// Projects, and sent you somewhere you had never been. This keeps a short
// trail of the pages actually visited this session, so Back returns to the
// previous one and says its name.
//
// The trail lives in sessionStorage: per tab, cleared when the tab closes,
// and never read by anything server-side.

const KEY = "navTrail";
const LIMIT = 20;

// A location is pathname + query + hash. The query matters because some
// pages carry their state in it (Analytics keeps its filter in ?f=), and
// the hash matters because the dashboard's tabs are hashes:
// /dashboard#pipeline and /dashboard#personal are different pages to a
// person even though they share a path.
export const locationOf = (win) => {
  if (!win) return "";
  return `${win.location.pathname}${win.location.search || ""}${win.location.hash || ""}`;
};

export function readTrail() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    // Private windows and blocked site data both land here. A missing
    // trail just means Back falls back to its default, which is fine.
    return [];
  }
}

function writeTrail(list) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(list.slice(-LIMIT)));
  } catch {
    // Nothing to do -- see readTrail.
  }
}

// Called on every location change. Repeats of the page you're already on
// are ignored, so a re-render or a scroll-restoring replace doesn't push a
// duplicate and make Back a no-op.
export function recordLocation(loc) {
  if (!loc) return;
  const trail = readTrail();
  if (trail[trail.length - 1] === loc) return;
  writeTrail([...trail, loc]);
}

// The page before the current one, or null when this is where they came in.
export function previousLocation() {
  const trail = readTrail();
  return trail.length >= 2 ? trail[trail.length - 2] : null;
}

// Called right before leaving a page that a just-finished action makes
// pointless to return to -- an Add Project / Add Pipeline Entry form,
// right after it saves and redirects to the new record. Without this, the
// record's own Back button would say "Back to Add Project" and reopen a
// blank form; dropping the form from the trail first means the record
// still records itself normally, but the entry below it is whatever page
// was open before the form -- My Projects, Pipeline, wherever it was
// actually opened from.
export function dropCurrentFromTrail() {
  const trail = readTrail();
  if (trail.length) writeTrail(trail.slice(0, -1));
}

// Going back drops both the current page and the one being returned to --
// the recorder puts the destination back on as soon as it loads, so the
// trail stays honest and a second Back goes one further rather than
// bouncing between two pages.
export function popToPrevious() {
  const trail = readTrail();
  if (trail.length >= 2) writeTrail(trail.slice(0, -2));
}

// Longest prefix wins, so /dashboard/directory/towers is "Installed
// Towers" rather than "Directory".
const PATH_LABELS = [
  ["/dashboard/directory/tower-model/", "Tower Model"],
  ["/dashboard/directory/tower/", "Tower"],
  ["/dashboard/directory/towers", "Installed Towers"],
  ["/dashboard/directory/product/", "Product"],
  ["/dashboard/directory/products", "Product Options"],
  ["/dashboard/directory/address/", "Address"],
  ["/dashboard/directory/addresses", "Project Addresses"],
  ["/dashboard/directory/company/", "Company"],
  ["/dashboard/directory/person/", "Person"],
  ["/dashboard/directory/duplicates", "Duplicate Records"],
  ["/dashboard/directory", "Directory"],
  ["/dashboard/analytics/details", "Analytics"],
  ["/dashboard/analytics", "Analytics"],
  ["/dashboard/pipeline/new", "Add Pipeline Entry"],
  ["/dashboard/pipeline/", "Pipeline Entry"],
  ["/dashboard/project/new", "Add Project"],
  ["/dashboard/project/", "Project"],
  ["/dashboard/parts/", "Parts Entry"],
  ["/dashboard/parts", "Parts"],
  ["/dashboard/scheduling", "Project Scheduling"],
  ["/dashboard/reminders", "Reminders"],
  ["/dashboard/alerts", "Alerts"],
  ["/dashboard/search", "Search"],
  ["/dashboard/photos", "Photos"]
];

const HASH_LABELS = {
  personal: "My Projects",
  pipeline: "Pipeline",
  team: "Team",
  pastProjects: "Past Projects",
  admin: "Admin Settings",
  home: "Home"
};

export function labelFor(loc) {
  if (!loc) return null;
  const [beforeHash, hash] = loc.split("#");
  // The query is state, not identity -- Analytics with a filter set is
  // still "Analytics".
  const path = beforeHash.split("?")[0];

  if (path === "/dashboard" || path === "/dashboard/") {
    return HASH_LABELS[hash] || "Home";
  }
  const hit = PATH_LABELS.find(([prefix]) => path.startsWith(prefix));
  return hit ? hit[1] : null;
}
