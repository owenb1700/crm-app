// "Needs review" flags for the Directory: a person with more than one phone
// number or email on file, or a company with more than one phone, address,
// or website (from merged duplicates). Someone confirms which is right --
// or that they're all right -- and the flag clears until something new is
// added. No Firebase imports.

const digits = (v) => String(v || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
const NORMALIZE = {
  phone: (v) => digits(v),
  email: (v) => String(v || "").trim().toLowerCase(),
  address: (v) => String(v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  website: (v) => String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "")
};

export const FIELD_LABELS = { phone: "phone number", email: "email", address: "address", website: "website" };

// Distinct values (first spelling of each kept), in their original order.
export function distinctValues(field, values) {
  const seen = new Set();
  return (values || []).filter(v => {
    const key = NORMALIZE[field](v);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Stored when someone confirms a set of values, so the same set isn't flagged again.
export const reviewSignature = (field, values) =>
  distinctValues(field, values).map(v => NORMALIZE[field](v)).sort().join("|");

const conflict = (record, field, values) => {
  const distinct = distinctValues(field, values);
  if (distinct.length < 2) return null;
  if (record.reviewed?.[field] === reviewSignature(field, distinct)) return null;
  return { field, values: distinct };
};

export const emailsOf = (person) => (person.emails?.length ? person.emails : (person.email ? [person.email] : []));
export const phonesOf = (person) => (person.phones?.length ? person.phones : (person.phone ? [person.phone] : []));

export function personConflicts(person) {
  return [conflict(person, "phone", phonesOf(person)), conflict(person, "email", emailsOf(person))].filter(Boolean);
}

export const companyValues = (company, field) => [company[field], ...((company.alternates || {})[field] || [])];

export function companyConflicts(company) {
  return ["phone", "address", "website"].map(f => conflict(company, f, companyValues(company, f))).filter(Boolean);
}

export const describeConflicts = (conflicts) =>
  conflicts.map(c => `${c.values.length} ${FIELD_LABELS[c.field]}${c.field === "address" ? "es" : "s"}`).join(", ");
