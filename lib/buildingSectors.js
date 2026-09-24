// What sort of building a given address is -- healthcare, commercial,
// industrial -- kept against the address itself.
//
// This is deliberately not borrowed from anybody. A firm's own street
// address is its office or its shop, it lives in the Directory under that
// firm, and it has nothing to do with where the work happens. The places
// we work come from projects, pipeline entries and parts requests, and
// each one carries its own sector.
//
// The knowledge then travels the other way: a contractor or engineering
// firm that turns up at a healthcare building is a firm that does
// healthcare work, so that sector is added to its file alongside whatever
// it already does. Over time that answers "who have we got for a
// hospital?" without anyone maintaining the list by hand.

import { normalizeAddress } from "./addresses";
import { sameCompany } from "./companyMatch";

export const SECTOR_COLLECTION = "buildingSectors";

// One document per building, keyed by the address in its comparable form,
// so the two spellings of one building share a sector.
export const sectorKey = (address) => normalizeAddress(address);

// Attach each building's own sectors from the stored records. A building
// nobody has typed a sector for simply has none -- it is never guessed.
export function applyBuildingSectors(buildings, records = []) {
  const byKey = new Map(
    (records || [])
      .filter(r => r && r.key)
      .map(r => [r.key, (r.sectors || []).filter(Boolean)])
  );
  return (buildings || []).map(b => ({ ...b, sectors: [...(byKey.get(b.key) || [])].sort() }));
}

// The sectors on offer: everything already recorded against a building,
// plus whatever the Directory already uses, so the two stay in step
// instead of drifting into two vocabularies.
export function knownSectors({ records = [], companies = [], extra = [] } = {}) {
  const all = new Set();
  for (const r of records) for (const s of r.sectors || []) if (s) all.add(s);
  for (const c of companies) for (const s of c.sectors || []) if (s) all.add(s);
  for (const s of extra) if (s) all.add(s);
  return [...all].sort();
}

// Which firms should learn something from this building, and what.
//
// Only firms that actually appear on work at the address, only sectors
// they don't already have, and nothing is ever taken away -- a firm's
// sectors only ever grow, because having done a hospital once stays true.
export function sectorUpdatesForFirms(firmNames = [], sectors = [], companies = []) {
  const wanted = (sectors || []).filter(Boolean);
  if (!wanted.length) return [];

  const updates = [];
  for (const name of new Set((firmNames || []).map(n => String(n || "").trim()).filter(Boolean))) {
    const firm = (companies || []).find(c => c && c.name && sameCompany(c.name, name));
    if (!firm) continue; // not in the Directory yet; nothing to write to
    const existing = (firm.sectors || []).filter(Boolean);
    const add = wanted.filter(s => !existing.includes(s));
    if (!add.length) continue;
    updates.push({
      id: firm.id,
      name: firm.name,
      add: [...add].sort(),
      sectors: [...new Set([...existing, ...add])].sort()
    });
  }
  return updates;
}

// Every firm named on the work at one address -- whoever the job is with,
// the owners on a project, the bidders on a pipeline entry, the
// contractors on a parts request.
export const firmsAtAddress = (rows = []) =>
  [...new Set((rows || []).flatMap(r => r.firms || []).map(f => String(f || "").trim()).filter(Boolean))].sort();

// A plain-English note for the firm's change log, so it's obvious why a
// sector appeared on a company nobody edited by hand.
export const sectorLogLine = (sectors, addressLabel) =>
  `${sectors.length === 1 ? "Sector" : "Sectors"} ${sectors.join(", ")} added from work at ${addressLabel}`;
