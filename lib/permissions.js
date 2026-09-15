// Roles and per-user feature access, shared by Admin Settings and anything
// that needs to describe or check them.

// "member" and "estimating" are stored as-is in Firestore; only the
// displayed text differs.
export const ROLE_LABELS = { admin: "Admin", member: "Salesperson", estimating: "Estimating Department" };
export const roleLabel = (role) => ROLE_LABELS[role] || role;
export const ROLE_OPTIONS = ["member", "estimating", "admin"];

// Per-user feature access, set at account creation and editable anytime
// from Admin Settings. Admins always have every permission regardless of
// this map. Anyone created before this existed (or with no permissions
// field at all) defaults to everything on -- except Analytics, which is
// off unless granted (Estimating and Admin always have it).
export const PERMISSION_DEFS = [
  { key: "dashboard", label: "Home & My Dashboard" },
  { key: "team", label: "Team" },
  { key: "pipeline", label: "Pipeline" },
  { key: "directory", label: "Directory (Companies & Contacts)" },
  { key: "towers", label: "Installed Towers & Tower Models" },
  { key: "products", label: "Product Options" },
  { key: "analytics", label: "Estimating Analytics", alwaysForRoles: ["estimating", "admin"] }
];
const OFF_BY_DEFAULT = ["analytics"];
export const DEFAULT_PERMISSIONS = PERMISSION_DEFS.reduce((acc, p) => ({ ...acc, [p.key]: !OFF_BY_DEFAULT.includes(p.key) }), {});

// What someone can actually use, given their role and stored permissions.
export function effectivePermissions(role, permissions) {
  const merged = { ...DEFAULT_PERMISSIONS, ...(permissions || {}) };
  return PERMISSION_DEFS.reduce((acc, p) => ({
    ...acc,
    [p.key]: role === "admin" || (p.alwaysForRoles || []).includes(role) || !!merged[p.key]
  }), {});
}

// A short label for the Team Members table.
export function accessSummary(user) {
  if (user.role === "admin") return "Full access";
  const perms = effectivePermissions(user.role, user.permissions);
  const on = PERMISSION_DEFS.filter(p => perms[p.key]).length;
  return on === PERMISSION_DEFS.length ? "Full access" : `${on} of ${PERMISSION_DEFS.length} areas`;
}
