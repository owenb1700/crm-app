import { sameCompany, samePerson } from "./companyMatch";

// Everything one person at one firm has been involved in: projects,
// pipeline entries, and parts. Records name people by name rather than by
// id, so matching uses the same normalisation the Directory does --
// "Dana Reed" and "dana reed" are one person, and only at the same firm.

const isThem = (person, firmName, recordCompany, recordContact) =>
  !!recordContact &&
  samePerson(recordContact, person) &&
  (!firmName || !recordCompany || sameCompany(recordCompany, firmName));

const day = (v) => (v?.seconds ? new Date(v.seconds * 1000).toISOString().slice(0, 10) : String(v || "").slice(0, 10));

// Projects: they can be the main contact, or a named building owner /
// engineer on the project.
export function projectsForPerson(projects, person, firmName) {
  return (projects || [])
    .filter(p =>
      isThem(person, firmName, p.company, p.contact) ||
      (p.owners || []).some(o => isThem(person, firmName, o.company, o.contact))
    )
    .map(p => ({
      kind: "Project",
      id: p.id,
      href: `/dashboard/project/${p.id}`,
      name: p.projectName || p.company || "Project",
      status: p.category || "",
      value: p.projectValue || "",
      date: day(p.nextCheckIn) || day(p.createdAt),
      role: isThem(person, firmName, p.company, p.contact) ? "Contact" : "Building owner / engineer"
    }));
}

// Pipeline: the engineering-firm contact, or a contact at one of the
// bidding firms.
export function pipelineForPerson(entries, person, firmName) {
  return (entries || [])
    .filter(e =>
      isThem(person, firmName, e.company, e.contact) ||
      (e.biddingCompanies || []).some(b => isThem(person, firmName, b.company, b.contact))
    )
    .map(e => ({
      kind: "Pipeline",
      id: e.id,
      href: `/dashboard/pipeline/${e.id}`,
      name: e.title || "Pipeline entry",
      status: e.outcome || e.stage || "",
      value: e.value || "",
      date: day(e.bidDate) || day(e.createdAt),
      role: isThem(person, firmName, e.company, e.contact) ? "Contact" : "Bidder contact"
    }));
}

export function partsForPerson(parts, person, firmName) {
  return (parts || [])
    .filter(p => isThem(person, firmName, p.company, p.contact))
    .map(p => ({
      kind: "Parts",
      id: p.id,
      href: "/dashboard/parts",
      name: p.item || "Parts entry",
      status: p.stage || "",
      value: p.value || "",
      date: day(p.neededBy) || day(p.createdAt),
      role: "Contact"
    }));
}

// Newest first, whatever kind it is.
export function historyForPerson({ person, firmName, projects, pipeline, parts }) {
  return [
    ...projectsForPerson(projects, person, firmName),
    ...pipelineForPerson(pipeline, person, firmName),
    ...partsForPerson(parts, person, firmName)
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export const countsByKind = (rows) =>
  (rows || []).reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] || 0) + 1 }), {});
