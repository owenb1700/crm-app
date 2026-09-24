// Tidying what people type, so the history it feeds stays worth
// searching. Two entries of the same phone number written differently are
// two numbers as far as the database is concerned, and the same is true of
// an address -- every suggestion the site makes gets weaker each time one
// fragments.

const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");

// US numbers written the one way. Anything that isn't a plain 10- or
// 11-digit number is left exactly as typed -- an extension, an
// international number, or a note beside it is not ours to mangle.
export function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/[a-zA-Z]/.test(raw)) return raw;

  const digits = digitsOf(raw);
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) {
    const rest = digits.slice(1);
    return `(${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
  }
  return raw;
}

export const samePhone = (a, b) => {
  const left = digitsOf(a).replace(/^1/, "");
  return Boolean(left) && left === digitsOf(b).replace(/^1/, "");
};

// ---------- addresses ----------

// Somebody genuinely has no address to give -- a parts order shipped to a
// yard, a firm we only know by phone. The field still has to be filled in,
// but this is an honest answer rather than a made-up street.
export const NOT_APPLICABLE = "N/A";

export const isNotApplicable = (value) =>
  ["n/a", "na", "not applicable", "none"].includes(String(value ?? "").trim().toLowerCase());

// An address is only "confirmed" once Google Maps has recognised it. A
// typed one that was never matched is accepted -- people work faster than
// an autocomplete -- but it's marked so the form can offer the tidy
// version instead.
export const addressState = ({ value, confirmed }) => {
  const text = String(value ?? "").trim();
  if (!text) return "empty";
  if (isNotApplicable(text)) return "not-applicable";
  return confirmed ? "confirmed" : "unverified";
};

// Is what Google gave back meaningfully different from what was typed?
// Case, punctuation, and a trailing country don't count -- only a real
// difference is worth interrupting someone over.
const comparable = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/,?\s*(usa|united states)\.?$/i, "")
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const worthCorrecting = (typed, suggested) => {
  const a = comparable(typed);
  const b = comparable(suggested);
  return Boolean(a) && Boolean(b) && a !== b;
};

// What the form should say when an address was typed rather than picked.
export const addressWarning = (state) =>
  state === "unverified"
    ? "This address hasn't been matched on Google Maps. Check the spelling, or pick a suggestion."
    : "";
