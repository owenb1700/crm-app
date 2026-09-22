import { parseMoney } from "./analytics";
import { sameCompany } from "./companyMatch";
import { firmTagsOf } from "./directory";

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

// Projects filed under the old "Parts" status, turned into parts entries.
// Everything that has a home on a parts entry comes across; the rest is
// written into the first log line so nothing is silently dropped.
export function partFromProject(project, { by, byName }) {
  const carried = [
    project.category ? `was a project filed as "${project.category}"` : null,
    project.buildingSector ? `sector ${project.buildingSector}` : null,
    project.workType || null,
    project.nextCheckIn ? `check-in ${String(project.nextCheckIn).slice(0, 10)}` : null
  ].filter(Boolean).join(", ");

  return {
    item: project.projectName || project.company || "Parts",
    company: project.company || "",
    companyCategory: project.companyCategory || "Contractor",
    contact: project.contact || "",
    email: project.email || "",
    phone: project.phone || "",
    value: project.projectValue || "",
    stage: "Quoted",
    neededBy: String(project.nextCheckIn || "").slice(0, 10),
    notes: "",
    projectAddress: project.projectAddress || "",
    contractors: [],
    ownerId: project.ownerId || by,
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: by,
    movedFromProjectId: project.id,
    log: [{
      kind: "created",
      changes: [`Moved from My Projects (${carried || "no other details"})`],
      note: "",
      by,
      byName,
      at: new Date().toISOString()
    }]
  };
}

export const isPartsProject = (project) => project?.category === "Parts";

// What kind of firm a parts request is for, spelled out for the card and
// the request's page: "Contractor - Supply House", or just the category
// when the firm has no types on file yet.
export function firmTypeLine(part, companies) {
  const category = part?.companyCategory || "";
  const firm = (companies || []).find(c => sameCompany(c.name, part?.company));
  const tags = firmTagsOf(firm);
  return tags.length ? `${category} - ${tags.join(", ")}` : category;
}

// Contractors need to say what they do. A firm that's new, or one already
// on file with nothing ticked, gets asked before the request is saved.
export function needsContractorType(payload, companies) {
  if ((payload?.companyCategory || "") !== "Contractor") return false;
  const name = (payload?.company || "").trim();
  if (!name) return false;
  const firm = (companies || []).find(c => sameCompany(c.name, name));
  return firmTagsOf(firm).length === 0;
}
