import { normalizeCompanyName, samePerson } from "./companyMatch";
import { distinctValues } from "./directoryConflicts";

const OWNER_CATEGORY = "Owner / Building Engineer";

// Turns spreadsheet rows (one row per person) into a Directory import plan:
// one entry per firm -- rows for the same firm (even spelled a little
// differently) are combined -- with its people, matched against what's
// already in the Directory. No Firebase imports; the Import screen builds
// the plan for its preview and the server re-checks it while saving.

export const IMPORT_FIELDS = [
  { key: "company", label: "Company", required: true, guesses: ["customer", "company", "account", "firm", "name"] },
  { key: "category", label: "Type", guesses: ["category", "type"] },
  { key: "address", label: "Street address", guesses: ["address", "street", "address 1"] },
  { key: "city", label: "City", guesses: ["city"] },
  { key: "state", label: "State", guesses: ["state", "st"] },
  { key: "zip", label: "Zip", guesses: ["zip", "zip code", "postal code"] },
  { key: "contact", label: "Contact name", guesses: ["contact", "contact name", "person"] },
  { key: "phone", label: "Phone", guesses: ["phone", "office phone", "telephone"] },
  { key: "cell", label: "Cell", guesses: ["cell", "mobile", "cell phone"] },
  { key: "email", label: "Email", guesses: ["email", "e-mail"] },
  { key: "website", label: "Website", guesses: ["website", "web", "url"] },
  { key: "rep", label: "Salesperson (rep)", guesses: ["rep", "salesperson", "sales rep"] },
  { key: "title", label: "Title", guesses: ["title", "position"] }
];

export function guessColumns(headers) {
  const lower = headers.map(h => h.trim().toLowerCase());
  return Object.fromEntries(IMPORT_FIELDS.map(f => {
    const i = lower.findIndex(h => f.guesses.includes(h));
    return [f.key, i >= 0 ? headers[i] : ""];
  }));
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

export const cleanPersonName = (v) => clean(v).replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, "").trim();

export const cleanPhone = (v) => clean(v).replace(/[`'"]/g, "").replace(/-{2,}/g, "-").replace(/^[\s-]+|[\s-]+$/g, "");

export function categoryFrom(value) {
  const v = clean(value).toLowerCase();
  if (v.startsWith("engineer")) return "Engineering Firm";
  if (v.startsWith("owner") || v.includes("building engineer")) return OWNER_CATEGORY;
  return "Contractor";
}

const addressFrom = (row, get) => {
  const street = clean(get(row, "address"));
  const city = clean(get(row, "city"));
  const stateZip = [clean(get(row, "state")), clean(get(row, "zip"))].filter(Boolean).join(" ");
  return [street, city, stateZip].filter(Boolean).join(", ");
};

// Most common value first (ties keep first-seen order).
const byFrequency = (values) => {
  const counts = new Map();
  values.filter(Boolean).forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
};

// rows: [{ header: value }]; columns: { fieldKey: header }; repToUser: { repName: userId }
export function buildImportPlan({ rows, columns, repToUser = {}, companies = [], contacts = [] }) {
  const get = (row, key) => (columns[key] ? row[columns[key]] : "");
  const firms = new Map();
  let skipped = 0;

  rows.forEach(row => {
    const name = clean(get(row, "company"));
    const key = normalizeCompanyName(name);
    if (!key) { skipped += 1; return; }
    if (!firms.has(key)) firms.set(key, { key, names: [], categories: [], addresses: [], phones: [], websites: [], reps: [], people: [] });
    const f = firms.get(key);
    f.names.push(name);
    if (columns.category) f.categories.push(categoryFrom(get(row, "category")));
    f.addresses.push(addressFrom(row, get));
    f.phones.push(cleanPhone(get(row, "phone")));
    f.websites.push(clean(get(row, "website")));
    f.reps.push(clean(get(row, "rep")));

    const personName = cleanPersonName(get(row, "contact"));
    if (personName) {
      const phones = [cleanPhone(get(row, "phone")), cleanPhone(get(row, "cell"))].filter(Boolean);
      const emails = [clean(get(row, "email"))].filter(Boolean);
      const title = clean(get(row, "title"));
      const existing = f.people.find(p => samePerson(p.name, personName));
      if (existing) {
        existing.phones = distinctValues("phone", [...existing.phones, ...phones]);
        existing.emails = distinctValues("email", [...existing.emails, ...emails]);
        existing.title = existing.title || title;
      } else {
        f.people.push({ name: personName, title, phones: distinctValues("phone", phones), emails: distinctValues("email", emails) });
      }
    }
  });

  const warnings = [];
  const plan = [...firms.values()].map(f => {
    const name = byFrequency(f.names)[0];
    const categories = byFrequency(f.categories);
    const addresses = distinctValues("address", byFrequency(f.addresses));
    const reps = byFrequency(f.reps);
    const existing = companies.find(c => normalizeCompanyName(c.name) === f.key) || null;
    const existingPeople = existing ? contacts.filter(p => p.companyId === existing.id) : [];

    if (categories.length > 1) warnings.push(`${name} is listed as ${categories.join(" and ")} -- importing as ${categories[0]}.`);
    if (reps.length > 1) warnings.push(`${name} has more than one rep (${reps.join(", ")}) -- using ${reps[0]}.`);

    return {
      key: f.key,
      name,
      spellings: [...new Set(f.names)].filter(n => n !== name),
      category: categories[0] || existing?.category || "Contractor",
      address: addresses[0] || "",
      alternateAddresses: addresses.slice(1),
      phone: byFrequency(f.phones)[0] || "",
      website: byFrequency(f.websites)[0] || "",
      rep: reps[0] || "",
      salespersonId: reps[0] ? (repToUser[reps[0]] || "") : "",
      existingId: existing?.id || null,
      existingName: existing?.name || null,
      people: f.people.map(p => ({ ...p, existingId: existingPeople.find(e => samePerson(e.name, p.name))?.id || null }))
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const people = plan.flatMap(f => f.people);
  return {
    firms: plan,
    warnings,
    stats: {
      rows: rows.length,
      skipped,
      firms: plan.length,
      newFirms: plan.filter(f => !f.existingId).length,
      existingFirms: plan.filter(f => f.existingId).length,
      people: people.length,
      newPeople: people.filter(p => !p.existingId).length,
      existingPeople: people.filter(p => p.existingId).length,
      multipleAddresses: plan.filter(f => f.alternateAddresses.length).length,
      withSalesperson: plan.filter(f => f.salespersonId).length,
      byCategory: plan.reduce((acc, f) => ({ ...acc, [f.category]: (acc[f.category] || 0) + 1 }), {})
    }
  };
}
