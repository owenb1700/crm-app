// Pipeline bidders: one row per bidding firm, with its salesperson and any
// number of people at that firm:
//   { category, company, salespersonId, contacts: [{ name, email, phone }] }
// Rows saved before people could be grouped hold a single person in
// contact / email / phone instead; every reader goes through contactsOf()
// so both shapes work. Stored rows also mirror their first person into
// contact / email / phone for anything that still reads those.

import { normalizeCompanyName } from "./companyMatch";

export const blankContact = () => ({ name: "", email: "", phone: "" });
export const blankBidder = () => ({ category: "Contractor", company: "", salespersonId: "", contacts: [blankContact()] });

const hasText = (v) => !!String(v || "").trim();
const contactHasData = (c) => hasText(c.name) || hasText(c.email) || hasText(c.phone);

export function contactsOf(bidder) {
  if (!bidder) return [];
  if (Array.isArray(bidder.contacts)) return bidder.contacts;
  return contactHasData({ name: bidder.contact, email: bidder.email, phone: bidder.phone })
    ? [{ name: bidder.contact || "", email: bidder.email || "", phone: bidder.phone || "" }]
    : [];
}

// Every person's name on an entry's bidders (for search, tower history...).
export const bidderContactNames = (bidders) =>
  (bidders || []).flatMap(b => contactsOf(b).map(c => c.name)).filter(hasText);

// Merges rows for the same firm (case-insensitive) into one, combining their
// people; the same person listed twice is kept once, filling in any missing
// email/phone. Rows with no firm name stay separate.
export function groupBidders(rows) {
  const grouped = [];
  const byCompany = new Map();

  (rows || []).forEach(row => {
    const contacts = contactsOf(row).map(c => ({ name: c.name || "", email: c.email || "", phone: c.phone || "" }));
    const key = normalizeCompanyName(row.company);
    const existing = key ? byCompany.get(key) : null;

    if (!existing) {
      const copy = {
        category: row.category || "Contractor",
        company: row.company || "",
        salespersonId: row.salespersonId || "",
        contacts
      };
      grouped.push(copy);
      if (key) byCompany.set(key, copy);
      return;
    }

    if (!existing.salespersonId && row.salespersonId) existing.salespersonId = row.salespersonId;
    contacts.forEach(c => {
      const nameKey = String(c.name || "").trim().toLowerCase();
      const match = nameKey && existing.contacts.find(e => String(e.name || "").trim().toLowerCase() === nameKey);
      if (match) {
        if (!hasText(match.email) && hasText(c.email)) match.email = c.email;
        if (!hasText(match.phone) && hasText(c.phone)) match.phone = c.phone;
      } else if (contactHasData(c)) {
        existing.contacts.push(c);
      }
    });
  });

  return grouped;
}

// For the editors: grouped, with at least one (possibly blank) person row
// per bidder so there's always somewhere to type.
export const bidderRowsForEditing = (rows) =>
  groupBidders(rows).map(b => ({ ...b, contacts: b.contacts.length ? b.contacts : [blankContact()] }));

// For saving: grouped, blank people and empty bidders dropped, first person
// mirrored into the legacy single-person fields.
export function biddersForStorage(rows) {
  return groupBidders(rows)
    .map(b => {
      const contacts = b.contacts
        .filter(contactHasData)
        .map(c => ({ name: String(c.name || "").trim(), email: String(c.email || "").trim(), phone: String(c.phone || "").trim() }));
      const first = contacts[0] || {};
      return {
        category: b.category || "Contractor",
        company: String(b.company || "").trim(),
        salespersonId: b.salespersonId || null,
        contacts,
        contact: first.name || null,
        email: first.email || null,
        phone: first.phone || null
      };
    })
    .filter(b => b.company || b.contacts.length);
}

// Directory capture entries: one per person, or one for the firm alone.
export const bidderDirectoryEntries = (rows, categoryOf) =>
  (rows || []).flatMap(b => {
    const contacts = contactsOf(b).filter(contactHasData);
    const category = categoryOf(b.category);
    return contacts.length
      ? contacts.map(c => ({ companyName: b.company, category, contactName: c.name, email: c.email, phone: c.phone }))
      : [{ companyName: b.company, category, contactName: "", email: "", phone: "" }];
  });

// The first bidder (by firm, after grouping) that's missing a salesperson.
export const bidderMissingSalesperson = (rows) =>
  groupBidders(rows).find(b => (hasText(b.company) || contactsOf(b).some(contactHasData)) && !b.salespersonId);
