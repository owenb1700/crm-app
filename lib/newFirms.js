import { sameCompany } from "./companyMatch";
import { firmTagsOf, firmTagOptions } from "./directory";

// A firm entered anywhere on the site should arrive described, not as a
// bare name: what a contractor does, or what sort of buildings an owner
// or engineering firm has. The little things -- office address, phone,
// website -- are left for whenever someone has them.
//
// This works out which firms on a form still need that, so the form can
// ask before saving.

export const findFirm = (companies, name) =>
  (companies || []).find(c => sameCompany(c.name, name)) || null;

// A firm needs details if it's new, or already on file with nothing
// ticked. Names are matched the Directory's way, so "Acme Mechanical,
// Inc." is the firm we already know.
export function firmNeedsDetails(name, companies) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  return firmTagsOf(findFirm(companies, trimmed)).length === 0;
}

// Everything named on one record, as {name, category} -- deduplicated,
// since the same firm can appear twice on a form.
export function firmsNeedingDetails(entries, companies) {
  const seen = new Set();
  const needed = [];
  (entries || []).forEach(({ name, category }) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (firmNeedsDetails(trimmed, companies)) {
      needed.push({ name: trimmed, category: category || "Contractor" });
    }
  });
  return needed;
}

// What the prompt should offer for that kind of firm.
export const optionsForCategory = (category) => firmTagOptions(category);

export const detailsLabel = (category) =>
  (category === "Contractor"
    ? "What kind of contractor are they?"
    : "What sort of buildings are they?");
