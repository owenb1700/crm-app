// Every building we've worked on, gathered from the addresses typed on
// projects, pipeline entries and parts orders. Nothing is stored twice --
// an address is just whatever was entered, matched loosely enough that
// "123 N State St." and "123 N State Street" are one building.

const STREET_WORDS = {
  street: "st", st: "st",
  avenue: "ave", ave: "ave", av: "ave",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  boulevard: "blvd", blvd: "blvd",
  lane: "ln", ln: "ln",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  parkway: "pkwy", pkwy: "pkwy",
  highway: "hwy", hwy: "hwy",
  suite: "ste", ste: "ste",
  north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw"
};

// A comparable form: lowercase, no punctuation, common street words
// shortened, and the country dropped.
export function normalizeAddress(address) {
  return String(address || "")
    .toLowerCase()
    .replace(/,?\s*(usa|united states)\.?$/i, "")
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(word => STREET_WORDS[word] || word)
    .join(" ")
    .trim();
}

export const sameAddress = (a, b) => {
  const left = normalizeAddress(a);
  return !!left && left === normalizeAddress(b);
};

// URL-safe handle for one address, so it can have its own page.
export const addressKey = (address) => encodeURIComponent(normalizeAddress(address));

const day = (v) => (v?.seconds ? new Date(v.seconds * 1000).toISOString().slice(0, 10) : String(v || "").slice(0, 10));

// Everything at one address, newest first, each row carrying who it was
// with so the page can answer "who did we work with here?".
export function workAtAddress({ address, projects = [], pipeline = [], parts = [] }) {
  const here = (value) => sameAddress(value, address);

  const rows = [
    ...projects.filter(p => here(p.projectAddress)).map(p => ({
      kind: "Project",
      id: p.id,
      href: `/dashboard/project/${p.id}`,
      name: p.projectName || p.company || "Project",
      status: p.category || "",
      value: p.projectValue || "",
      date: day(p.nextCheckIn) || day(p.createdAt),
      firms: [p.company, ...(p.owners || []).map(o => o.company)].filter(Boolean),
      people: [p.contact, ...(p.owners || []).map(o => o.contact)].filter(Boolean),
      ownerId: p.ownerId
    })),
    ...pipeline.filter(e => here(e.projectAddress)).map(e => ({
      kind: "Pipeline",
      id: e.id,
      href: `/dashboard/pipeline/${e.id}`,
      name: e.title || "Pipeline entry",
      status: e.outcome || e.stage || "",
      value: e.value || "",
      date: day(e.bidDate) || day(e.createdAt),
      firms: [e.company, ...(e.biddingCompanies || []).map(b => b.company)].filter(Boolean),
      people: [e.contact, ...(e.biddingCompanies || []).map(b => b.contact)].filter(Boolean),
      ownerId: e.ownerId
    })),
    ...parts.filter(p => here(p.projectAddress)).map(p => ({
      kind: "Parts",
      id: p.id,
      href: `/dashboard/parts/${p.id}`,
      name: p.item || "Parts entry",
      status: p.stage || "",
      value: p.value || "",
      date: day(p.neededBy) || day(p.createdAt),
      firms: [p.company, ...(p.contractors || []).map(c => c.company)].filter(Boolean),
      people: [p.contact, ...(p.contractors || []).map(c => c.contact)].filter(Boolean),
      ownerId: p.ownerId
    }))
  ];

  return rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// One entry per building, with how much work is on it. The label shown is
// the longest spelling seen, which is usually the most complete one.
export function collectAddresses({ projects = [], pipeline = [], parts = [] }) {
  const buildings = new Map();

  const add = (address, kind, date) => {
    const key = normalizeAddress(address);
    if (!key) return;
    const found = buildings.get(key) || { key, label: "", counts: { Project: 0, Pipeline: 0, Parts: 0 }, total: 0, latest: "" };
    const label = String(address || "").trim();
    if (label.length > found.label.length) found.label = label;
    found.counts[kind] += 1;
    found.total += 1;
    if (String(date || "") > found.latest) found.latest = String(date || "");
    buildings.set(key, found);
  };

  projects.forEach(p => add(p.projectAddress, "Project", day(p.nextCheckIn) || day(p.createdAt)));
  pipeline.forEach(e => add(e.projectAddress, "Pipeline", day(e.bidDate) || day(e.createdAt)));
  parts.forEach(p => add(p.projectAddress, "Parts", day(p.neededBy) || day(p.createdAt)));

  return [...buildings.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export const matchesAddressSearch = (building, q) => {
  const needle = normalizeAddress(q);
  return !needle || building.key.includes(needle);
};

// Distinct firms / people across a set of rows, for "who we worked with".
export const uniqueNames = (rows, field) =>
  [...new Set((rows || []).flatMap(r => r[field] || []).map(v => String(v).trim()).filter(Boolean))].sort();
