import { sameCompany } from "./companyMatch";

// Everything a firm has been part of: projects, pipeline entries and parts
// requests alike. A firm turns up in more than one role -- the contractor
// on a project, a building owner named on it, one of the firms bidding an
// entry, or a contractor doing parts work -- and each row says which, who
// there was involved, and the building it was at.

const day = (v) => (v?.seconds ? new Date(v.seconds * 1000).toISOString().slice(0, 10) : String(v || "").slice(0, 10));
const is = (name, value) => !!value && sameCompany(value, name);

export function projectsForFirm(projects, firmName) {
  return (projects || [])
    .map(p => {
      const owner = (p.owners || []).find(o => is(firmName, o.company));
      if (is(firmName, p.company)) {
        return { record: p, role: "Contractor / owner", person: p.contact || "" };
      }
      if (owner) return { record: p, role: "Building owner / engineer", person: owner.contact || "" };
      return null;
    })
    .filter(Boolean)
    .map(({ record: p, role, person }) => ({
      kind: "Project",
      id: p.id,
      href: `/dashboard/project/${p.id}`,
      name: p.projectName || p.company || "Project",
      status: p.category || "",
      value: p.projectValue || "",
      date: day(p.nextCheckIn) || day(p.createdAt),
      address: p.projectAddress || "",
      person,
      role
    }));
}

export function pipelineForFirm(entries, firmName) {
  return (entries || [])
    .map(e => {
      const bidder = (e.biddingCompanies || []).find(b => is(firmName, b.company));
      if (is(firmName, e.company)) return { record: e, role: "Engineering firm", person: e.contact || "" };
      if (bidder) return { record: e, role: "Bidding", person: bidder.contact || "" };
      return null;
    })
    .filter(Boolean)
    .map(({ record: e, role, person }) => ({
      kind: "Pipeline",
      id: e.id,
      href: `/dashboard/pipeline/${e.id}`,
      name: e.title || "Pipeline entry",
      status: e.outcome || e.stage || "",
      value: e.value || "",
      date: day(e.bidDate) || day(e.createdAt),
      address: e.projectAddress || "",
      person,
      role
    }));
}

export function partsForFirm(parts, firmName) {
  return (parts || [])
    .map(p => {
      const contractor = (p.contractors || []).find(c => is(firmName, c.company));
      if (is(firmName, p.company)) return { record: p, role: "Requested by", person: p.contact || "" };
      if (contractor) return { record: p, role: "Contractor", person: contractor.contact || "" };
      return null;
    })
    .filter(Boolean)
    .map(({ record: p, role, person }) => ({
      kind: "Parts",
      id: p.id,
      href: `/dashboard/parts/${p.id}`,
      name: p.item || "Parts request",
      status: p.stage || "",
      value: p.value || "",
      date: day(p.neededBy) || day(p.createdAt),
      address: p.projectAddress || "",
      person,
      role
    }));
}

export function historyForFirm({ firmName, projects, pipeline, parts }) {
  if (!firmName) return [];
  return [
    ...projectsForFirm(projects, firmName),
    ...pipelineForFirm(pipeline, firmName),
    ...partsForFirm(parts, firmName)
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export const countsByKind = (rows) =>
  (rows || []).reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] || 0) + 1 }), {});
