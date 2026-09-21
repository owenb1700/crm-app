import { parseMoney } from "./analytics";

// Parts entries: a part quoted or sold to a firm, kept apart from projects
// and pipeline entries because they're small, frequent, and belong to
// whoever is handling them rather than to a salesperson's book of work.
//
// Everyone can see and edit them; only the person who entered one (or an
// admin) can delete it.

export const PART_STAGES = ["Quoted", "Ordered", "Shipped", "Delivered", "Invoiced", "Closed"];

export const blankContractor = () => ({ company: "", contact: "" });

export const blankPart = () => ({
  item: "",
  company: "",
  companyCategory: "Contractor",
  contact: "",
  email: "",
  phone: "",
  value: "",
  stage: "Quoted",
  neededBy: "",
  notes: "",
  projectAddress: "",
  // Contractors doing the work, beyond whoever the request came from.
  contractors: []
});

export const cleanContractors = (rows) =>
  (rows || [])
    .map(r => ({ company: (r.company || "").trim(), contact: (r.contact || "").trim() }))
    .filter(r => r.company);

export const describeContractors = (rows) =>
  cleanContractors(rows).map(r => (r.contact ? `${r.company} (${r.contact})` : r.company)).join("; ");

// What actually gets stored, trimmed and with nothing undefined.
export const partPayload = (form) => ({
  item: (form.item || "").trim(),
  company: (form.company || "").trim(),
  companyCategory: form.companyCategory || "Contractor",
  contact: (form.contact || "").trim(),
  email: (form.email || "").trim(),
  phone: (form.phone || "").trim(),
  value: (form.value || "").trim(),
  stage: PART_STAGES.includes(form.stage) ? form.stage : "Quoted",
  neededBy: form.neededBy || "",
  notes: (form.notes || "").trim(),
  projectAddress: (form.projectAddress || "").trim(),
  contractors: cleanContractors(form.contractors)
});

export const partError = (form) => {
  if (!(form.item || "").trim()) return "Give the part a name.";
  if (!(form.company || "").trim()) return "Pick the firm this is for.";
  return "";
};

export const partValue = (p) => parseMoney(p?.value) ?? 0;

// Newest work first, but anything still open outranks what's finished.
const OPEN_FIRST = (p) => (p.stage === "Closed" || p.stage === "Invoiced" ? 1 : 0);
export const sortParts = (parts) =>
  [...(parts || [])].sort(
    (a, b) =>
      OPEN_FIRST(a) - OPEN_FIRST(b) ||
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );

export const matchesPartSearch = (p, q) => {
  const needle = (q || "").trim().toLowerCase();
  if (!needle) return true;
  return [p.item, p.company, p.contact, p.notes, p.stage, p.value]
    .filter(Boolean)
    .some(v => String(v).toLowerCase().includes(needle));
};

export const filterParts = (parts, { search, stage, category, firm, person }) =>
  (parts || [])
    .filter(p => !stage || p.stage === stage)
    .filter(p => !category || p.companyCategory === category)
    .filter(p => !firm || p.company === firm)
    .filter(p => !person || p.ownerId === person)
    .filter(p => matchesPartSearch(p, search));

export const partsTotal = (parts) => (parts || []).reduce((sum, p) => sum + partValue(p), 0);

// What changed between two versions, in words, for the entry's log. Parts
// are shared -- anyone can edit one -- so every change says who made it.
const FIELD_LABELS = {
  item: "Part",
  company: "Firm",
  companyCategory: "Firm type",
  contact: "Contact",
  email: "Email",
  phone: "Phone",
  value: "Value",
  stage: "Stage",
  neededBy: "Needed by",
  notes: "Notes",
  projectAddress: "Project address",
  contractors: "Contractors"
};

const asText = (field, value) =>
  (field === "contractors" ? describeContractors(value) : String(value ?? "").trim());

export function partChanges(before, after) {
  return Object.keys(FIELD_LABELS)
    .map(field => {
      const from = asText(field, before?.[field]);
      const to = asText(field, after?.[field]);
      return from === to ? null : { field, label: FIELD_LABELS[field], from, to };
    })
    .filter(Boolean);
}

// One line per change, e.g. 'Stage: Quoted -> Ordered'.
export const describeChange = (c) =>
  `${c.label}: ${c.from || "(blank)"} → ${c.to || "(blank)"}`;

export const logEntry = ({ kind, changes = [], by, byName, note = "" }) => ({
  kind, // "created" | "updated" | "note"
  changes: changes.map(describeChange),
  note,
  by,
  byName,
  at: new Date().toISOString()
});
