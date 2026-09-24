// Every building we've worked on, gathered from the addresses typed on
// projects, pipeline entries and parts orders. Nothing is stored twice --
// an address is just whatever was entered, matched loosely enough that
// "123 N State St." and "123 N State Street" are one building.
import { sameCompany } from "./companyMatch";

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

  const add = (address, kind, date, firms = [], people = []) => {
    const key = normalizeAddress(address);
    if (!key) return;
    const found = buildings.get(key) || {
      key, label: "", counts: { Project: 0, Pipeline: 0, Parts: 0 }, total: 0, latest: "",
      firms: [], people: [], sectors: [], workTypes: []
    };
    const label = String(address || "").trim();
    if (label.length > found.label.length) found.label = label;
    found.counts[kind] += 1;
    found.total += 1;
    if (String(date || "") > found.latest) found.latest = String(date || "");
    // Who we've dealt with at this building, so it can be found by them
    // and not only by its street address.
    for (const name of firms) if (name && !found.firms.includes(name)) found.firms.push(name);
    for (const name of people) if (name && !found.people.includes(name)) found.people.push(name);
    buildings.set(key, found);
  };

  projects.forEach(p => add(
    p.projectAddress, "Project", day(p.nextCheckIn) || day(p.createdAt),
    [p.company, ...(p.owners || []).map(o => o.company)],
    [p.contact, ...(p.owners || []).map(o => o.contact)]
  ));
  pipeline.forEach(e => add(
    e.projectAddress, "Pipeline", day(e.bidDate) || day(e.createdAt),
    [e.company, ...(e.biddingCompanies || []).map(b => b.company)],
    [e.contact, ...(e.biddingCompanies || []).map(b => b.contact)]
  ));
  parts.forEach(p => add(
    p.projectAddress, "Parts", day(p.neededBy) || day(p.createdAt),
    [p.company, ...(p.contractors || []).map(c => c.company)],
    [p.contact, ...(p.contractors || []).map(c => c.contact)]
  ));

  return [...buildings.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// What sort of building this is, and what sort of work goes on in it,
// borrowed from the firms we've dealt with there. A building has no type
// of its own -- nobody types one in -- so it inherits: an owner or
// engineering firm brings its sectors (Healthcare, Commercial...), a
// contractor brings what it does (Service, Construction, Supply House).
export function describeBuildings(buildings, companies = []) {
  const known = (companies || []).filter(c => c && c.name);
  return (buildings || []).map(b => {
    const sectors = new Set();
    const workTypes = new Set();
    for (const firmName of b.firms || []) {
      const firm = known.find(c => sameCompany(c.name, firmName));
      if (!firm) continue;
      for (const s of firm.sectors || []) if (s) sectors.add(s);
      for (const w of firm.workTypes || []) if (w) workTypes.add(w);
    }
    return { ...b, sectors: [...sectors].sort(), workTypes: [...workTypes].sort() };
  });
}

// The choices to offer in the filter boxes -- only what's actually on the
// list, so nothing offers a sector that would return nothing.
export function addressFacets(buildings) {
  const pick = (field) =>
    [...new Set((buildings || []).flatMap(b => b[field] || []).filter(Boolean))].sort();
  return {
    sectors: pick("sectors"),
    workTypes: pick("workTypes"),
    firms: pick("firms")
  };
}

export const matchesAddressSearch = (building, q) => {
  const raw = String(q || "").trim().toLowerCase();
  if (!raw) return true;
  // The address itself is matched in its comparable form, so "123 N State
  // Street" finds "123 N State St".
  const needle = normalizeAddress(q);
  if (needle && building.key.includes(needle)) return true;
  // Everything else is matched as typed.
  return [
    ...(building.firms || []), ...(building.people || []),
    ...(building.sectors || []), ...(building.workTypes || [])
  ].some(v => String(v).toLowerCase().includes(raw));
};

// One filter for the whole page: the search box plus the dropdowns.
// Blank means "no opinion", so the default shows everything.
export const filterBuildings = (buildings, { search = "", sector = "", workType = "", firm = "", kind = "" } = {}) =>
  (buildings || [])
    .filter(b => !sector || (b.sectors || []).includes(sector))
    .filter(b => !workType || (b.workTypes || []).includes(workType))
    .filter(b => !firm || (b.firms || []).some(f => sameCompany(f, firm)))
    .filter(b => !kind || (b.counts?.[kind] || 0) > 0)
    .filter(b => matchesAddressSearch(b, search));

// Distinct firms / people across a set of rows, for "who we worked with".
export const uniqueNames = (rows, field) =>
  [...new Set((rows || []).flatMap(r => r[field] || []).map(v => String(v).trim()).filter(Boolean))].sort();

// ---------- near-duplicate buildings ----------
//
// Firms match on spelling; buildings can't, quite. "123 N State St" and
// "125 N State St" read almost the same and are different buildings, so
// the street number has to agree exactly before anything else counts.

const houseNumber = (key) => (key.match(/^(\d+)/) || [])[1] || "";
const words = (key) => key.split(" ").filter(Boolean);

// Directions and street types say nothing about *which* street it is --
// "123 N State St" and "123 N Clark St" share everything but the name.
const NOISE = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "st", "ave", "rd", "dr", "blvd", "ln", "ct", "pl", "pkwy", "hwy", "ste"
]);

// The street name and anything after it: the part that identifies the road.
const streetWords = (key) => words(key).filter(w => !/^\d+$/.test(w) && !NOISE.has(w));

// How much two normalised addresses share, once the number matches.
function addressOverlap(a, b) {
  const left = new Set(words(a));
  const right = words(b);
  if (!left.size || !right.length) return 0;
  const shared = right.filter(w => left.has(w)).length;
  return shared / Math.max(left.size, right.length);
}

// Close enough to be worth asking about, but not the same address.
export function similarAddresses(a, b) {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  if (!left || !right || left === right) return false;
  // A different street number is a different building, full stop.
  const leftNumber = houseNumber(left);
  const rightNumber = houseNumber(right);
  if (leftNumber !== rightNumber) return false;
  // And so is a different street -- same number, same direction and same
  // "St" count for nothing if one is State and the other is Clark.
  const leftStreet = streetWords(left);
  const rightStreet = streetWords(right);
  if (!leftStreet.length || !rightStreet.length) return false;
  if (leftStreet[0] !== rightStreet[0]) return false;
  // Same number and street in two different towns is two buildings. If
  // both spell out what comes after the street and none of it agrees,
  // they're not the same place.
  const leftRest = leftStreet.slice(1);
  const rightRest = rightStreet.slice(1);
  if (leftRest.length && rightRest.length && !leftRest.some(w => rightRest.includes(w))) return false;
  // One being the fuller version of the other ("123 n state st" inside
  // "123 n state st chicago il") is the common case.
  if (left.startsWith(right) || right.startsWith(left)) return true;
  return addressOverlap(left, right) >= 0.6;
}

// Addresses already on file that this one is close to, best first.
export function findSimilarAddresses(buildings, address, limit = 3) {
  if (normalizeAddress(address).length < 4) return [];
  return (buildings || [])
    .filter(b => similarAddresses(b.label, address))
    .map(b => ({ building: b, score: addressOverlap(normalizeAddress(b.label), normalizeAddress(address)) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(x => x.building);
}

// Buildings on file that look like the same place, grouped -- for the
// review list, run over everything already entered.
export function groupSimilarAddresses(buildings) {
  const list = [...(buildings || [])];
  const used = new Set();
  const groups = [];
  list.forEach((b, i) => {
    if (used.has(b.key)) return;
    const group = [b];
    list.slice(i + 1).forEach(other => {
      if (used.has(other.key)) return;
      if (group.some(g => similarAddresses(g.label, other.label))) {
        group.push(other);
        used.add(other.key);
      }
    });
    if (group.length > 1) {
      group.forEach(g => used.add(g.key));
      groups.push(group);
    }
  });
  return groups;
}
