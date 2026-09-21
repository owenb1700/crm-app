// Roles and per-user feature access, shared by Admin Settings and anything
// that needs to describe or check them.

// "member" and "estimating" are stored as-is in Firestore; only the
// displayed text differs.
export const ROLE_LABELS = { admin: "Admin", member: "Salesperson", estimating: "Estimating Department" };
export const roleLabel = (role) => ROLE_LABELS[role] || role;
export const ROLE_OPTIONS = ["member", "estimating", "admin"];

// Per-user feature access, set at account creation and editable anytime
// from Admin Settings. Every permission can be switched on or off for
// anyone; a role only decides what a NEW account starts with. (Admins are
// the exception -- they always have everything, or they could lock
// themselves out of Admin Settings.)
//
// defaultForRoles: on for that role unless someone turns it off. Anyone
// created before this existed (no permissions field at all) still defaults
// to everything on except Analytics.
export const PERMISSION_DEFS = [
  { key: "dashboard", label: "Home & My Projects" },
  { key: "team", label: "Team" },
  { key: "pipeline", label: "Pipeline" },
  { key: "directory", label: "Directory (Companies & Contacts)" },
  { key: "towers", label: "Installed Towers & Tower Models" },
  { key: "products", label: "Product Options" },
  // Analytics itself is open to everyone -- it's your own numbers. This
  // decides whether you also see everyone else's and can filter by
  // salesperson.
  { key: "viewOthersStats", label: "Analytics: View Other People's Stats", defaultForRoles: ["estimating", "admin"] },
  // Enter a project on someone else's behalf: the salesperson picked on
  // the form owns it, and whoever entered it works it alongside them.
  { key: "enterForOthers", label: "Enter Projects for Other People" }
];
const OFF_BY_DEFAULT = ["viewOthersStats", "enterForOthers"];
export const DEFAULT_PERMISSIONS = PERMISSION_DEFS.reduce((acc, p) => ({ ...acc, [p.key]: !OFF_BY_DEFAULT.includes(p.key) }), {});

// What someone can actually use, given their role and stored permissions.
export function effectivePermissions(role, permissions) {
  const stored = permissions || {};
  // Before Analytics was opened to everyone, one "analytics" permission
  // decided who could see the page at all -- and that page showed the whole
  // company. Anyone who had it keeps the wider view under its new name.
  if (typeof stored.viewOthersStats !== "boolean" && typeof stored.analytics === "boolean") {
    stored.viewOthersStats = stored.analytics;
  }
  return PERMISSION_DEFS.reduce((acc, p) => {
    // An explicit choice always wins -- including turning off something
    // the person's role would otherwise start with.
    const set = typeof stored[p.key] === "boolean" ? stored[p.key] : null;
    const byRole = (p.defaultForRoles || []).includes(role) || DEFAULT_PERMISSIONS[p.key];
    return { ...acc, [p.key]: role === "admin" ? true : (set === null ? !!byRole : set) };
  }, {});
}

// What a brand-new account of this role starts with, before anyone edits
// the checkboxes.
export const defaultPermissionsFor = (role) =>
  PERMISSION_DEFS.reduce((acc, p) => ({
    ...acc,
    [p.key]: (p.defaultForRoles || []).includes(role) || DEFAULT_PERMISSIONS[p.key]
  }), {});

// A short label for the Team Members table.
export function accessSummary(user) {
  if (user.role === "admin") return "Full access";
  const perms = effectivePermissions(user.role, user.permissions);
  const on = PERMISSION_DEFS.filter(p => perms[p.key]).length;
  return on === PERMISSION_DEFS.length ? "Full access" : `${on} of ${PERMISSION_DEFS.length} areas`;
}

// Who can file a project under someone else's name (see the
// enterForOthers permission). Admins always can.
export const canEnterForOthers = (profile) =>
  !!profile && !profile.disabled &&
  (profile.role === "admin" || profile.permissions?.enterForOthers === true);
