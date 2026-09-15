import { collection, addDoc, updateDoc, doc, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { contactsOf } from "./bidders";

export const OWNER_CATEGORY = "Owner / Building Engineer";
export const COMPANY_CATEGORIES = ["Contractor", "Engineering Firm", OWNER_CATEGORY];

// Display names for the Directory's category filter (the stored category
// value stays singular).
export const CATEGORY_TITLES = {
  Contractor: "Contractors",
  "Engineering Firm": "Engineering Firms",
  [OWNER_CATEGORY]: "Owners & Building Engineers"
};

// Firm types that can fill a "contractor" slot -- a project's main company
// field or a pipeline bidding row. Stored on the record (companyCategory /
// row.category) so the right Directory category is used on save; anything
// saved before this existed has neither and is a Contractor.
export const FIRM_TYPES = ["Contractor", OWNER_CATEGORY];
export const firmTypeOf = (value) => (FIRM_TYPES.includes(value) ? value : "Contractor");

// A project's owner/building-engineer firms, stored as a list of
// { company, contact, email, phone } rows -- same shape as a pipeline
// entry's biddingCompanies.
export const BLANK_OWNER_ROW = { company: "", contact: "", email: "", phone: "" };
export const cleanOwnerRows = (rows) => (rows || []).filter(r => (r.company || "").trim() || (r.contact || "").trim());

// A contact can have several emails/phones on file; the "primary" one
// (first in the list) is what gets written into the single email/phone
// field every Project or Pipeline entry stores. Falls back to the old
// singular email/phone fields for contacts saved before multi-value
// support existed.
export const primaryEmail = (contact) => (contact?.emails && contact.emails[0]) || contact?.email || "";
export const primaryPhone = (contact) => (contact?.phones && contact.phones[0]) || contact?.phone || "";

// Silently creates/updates company + contact directory records from data
// entered elsewhere in the app (project/pipeline forms), so the directory
// builds itself up from normal usage without any extra clicks. Safe to
// call with a blank contact name (e.g. a company-only field) -- it just
// won't create a contact in that case.
//
// Returns the resolved { company, contact } records (or null if nothing
// was resolved) so a caller doing several of these in one save can fold
// newly-created records back into its working lists before the next call
// -- otherwise two rows sharing a brand-new company name in the same save
// could each decide "doesn't exist yet" and create a duplicate.
export async function ensureCompanyAndContact({
  companies,
  contacts,
  companyName,
  category,
  contactName,
  email,
  phone,
  uid
}) {
  const name = (companyName || "").trim();
  if (!name) return { company: null, contact: null };

  let company = companies.find(c => c.name.toLowerCase() === name.toLowerCase());

  if (!company) {
    const ref = await addDoc(collection(db, "companies"), {
      name,
      category: category || "Contractor",
      phone: null,
      address: null,
      website: null,
      notes: null,
      createdAt: new Date().toISOString(),
      createdBy: uid
    });
    company = { id: ref.id, name, category: category || "Contractor" };
  } else if (category && company.category !== category) {
    // A company's role can shift between saves -- e.g. tagged Contractor
    // from an old bid, now showing up as the Engineering Firm on a new
    // pipeline entry. Keep the category matching whatever role it was
    // most recently entered under, so it always lands under the right
    // Directory filter instead of being stuck under whatever it was
    // first tagged as.
    await updateDoc(doc(db, "companies", company.id), { category });
    company = { ...company, category };
  }

  const personName = (contactName || "").trim();
  if (!personName) return { company, contact: null };

  let existingContact = contacts.find(
    c => c.companyId === company.id && c.name.toLowerCase() === personName.toLowerCase()
  );

  if (!existingContact) {
    const contactData = {
      name: personName,
      emails: email ? [email] : [],
      phones: phone ? [phone] : [],
      title: null,
      companyId: company.id,
      companyName: name,
      createdAt: new Date().toISOString(),
      createdBy: uid
    };
    const ref = await addDoc(collection(db, "contacts"), contactData);
    existingContact = { id: ref.id, ...contactData };
  } else {
    // A person can have multiple emails/phones on file. Typing one in on a
    // project/pipeline form never overwrites or removes what's already
    // there -- it only adds it to the list if it isn't already on it.
    const currentEmails = existingContact.emails?.length ? existingContact.emails : (existingContact.email ? [existingContact.email] : []);
    const currentPhones = existingContact.phones?.length ? existingContact.phones : (existingContact.phone ? [existingContact.phone] : []);

    const updates = {};
    let newEmails = currentEmails;
    let newPhones = currentPhones;

    if (email && !currentEmails.some(e => e.toLowerCase() === email.toLowerCase())) {
      newEmails = [...currentEmails, email];
      updates.emails = newEmails;
    }
    if (phone && !currentPhones.includes(phone)) {
      newPhones = [...currentPhones, phone];
      updates.phones = newPhones;
    }

    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, "contacts", existingContact.id), updates);
      existingContact = { ...existingContact, ...updates };

      // Only cascade to other project/pipeline entries if the *primary*
      // (first) email/phone actually changed -- that's the one value
      // those single-value fields can hold.
      if (newEmails[0] !== currentEmails[0] || newPhones[0] !== currentPhones[0]) {
        await propagateContactUpdate({
          companyName: name,
          oldContactName: existingContact.name,
          newContactName: existingContact.name,
          email: newEmails[0] || null,
          phone: newPhones[0] || null
        });
      }
    }
  }

  return { company, contact: existingContact };
}

// Runs a batch of ensureCompanyAndContact calls one at a time, feeding
// each result back into a local working copy of companies/contacts so
// later calls in the same batch see records the earlier ones just
// created. Use this instead of Promise.all whenever a single save could
// touch more than one company/contact (e.g. an engineering firm plus a
// list of contractor rows).
// Editing a contact in the Directory only changes that one contacts/ doc --
// every project or pipeline entry that already captured this person's name/
// email/phone at the time it was saved is holding a stale snapshot. Call
// this right after updating a contact so every place that referenced them
// (by company + name) picks up the edit, including a rename.
export async function propagateContactUpdate({ companyName, oldContactName, newContactName, email, phone }) {
  if (!oldContactName) return;

  const matches = (rowCompany, rowContact) =>
    (rowCompany || "") === companyName && (rowContact || "") === oldContactName;

  const [customersSnap, pipelineSnap] = await Promise.all([
    getDocs(collection(db, "customers")),
    getDocs(collection(db, "pipeline"))
  ]);

  const writes = [];

  customersSnap.docs.forEach(d => {
    const data = d.data();
    let payload = null;

    if (matches(data.company, data.contact)) {
      payload = { contact: newContactName, email: email || null, phone: phone || null };
    }

    const owners = data.owners || [];
    let ownersChanged = false;
    const newOwners = owners.map(row => {
      if (matches(row.company, row.contact)) {
        ownersChanged = true;
        return { ...row, contact: newContactName, email: email || null, phone: phone || null };
      }
      return row;
    });
    if (ownersChanged) {
      payload = { ...(payload || {}), owners: newOwners };
    }

    if (payload) {
      writes.push(updateDoc(doc(db, "customers", d.id), payload));
    }
  });

  pipelineSnap.docs.forEach(d => {
    const data = d.data();
    let payload = null;

    if (matches(data.company, data.contact)) {
      payload = { contact: newContactName, email: email || null, phone: phone || null };
    }

    // Bidders hold a list of people per firm (older rows hold one person in
    // contact/email/phone); update whichever person matches, and keep the
    // first-person mirror fields in step.
    const bidding = data.biddingCompanies || [];
    let biddingChanged = false;
    const newBidding = bidding.map(row => {
      if ((row.company || "") !== companyName) return row;
      let rowChanged = false;
      const people = contactsOf(row).map(c => {
        if ((c.name || "") !== oldContactName) return c;
        rowChanged = true;
        return { ...c, name: newContactName, email: email || "", phone: phone || "" };
      });
      if (!rowChanged) return row;
      biddingChanged = true;
      const first = people[0] || {};
      return { ...row, contacts: people, contact: first.name || null, email: first.email || null, phone: first.phone || null };
    });
    if (biddingChanged) {
      payload = { ...(payload || {}), biddingCompanies: newBidding };
    }

    if (payload) {
      writes.push(updateDoc(doc(db, "pipeline", d.id), payload));
    }
  });

  await Promise.all(writes);
}

export async function ensureCompanyAndContactBatch(entries, { companies, contacts, uid }) {
  const workingCompanies = [...companies];
  const workingContacts = [...contacts];

  for (const entry of entries) {
    const result = await ensureCompanyAndContact({
      ...entry,
      companies: workingCompanies,
      contacts: workingContacts,
      uid
    });

    if (result?.company && !workingCompanies.some(c => c.id === result.company.id)) {
      workingCompanies.push(result.company);
    }
    if (result?.contact && !workingContacts.some(c => c.id === result.contact.id)) {
      workingContacts.push(result.contact);
    }
  }
}

// Required on every project and pipeline entry, new or edited.
export const BUILDING_SECTORS = ["Government", "Healthcare", "Office", "Residential", "Education", "Industrial"];

// Every project and pipeline entry is exactly one of these.
export const WORK_TYPES = ["New Installation", "Replacement", "Repair"];

