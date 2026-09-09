import { collection, addDoc, updateDoc, doc, getDocs } from "firebase/firestore";
import { db } from "./firebase";

export const COMPANY_CATEGORIES = ["Contractor", "Engineering Firm"];

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
  }

  const personName = (contactName || "").trim();
  if (!personName) return { company, contact: null };

  let existingContact = contacts.find(
    c => c.companyId === company.id && c.name.toLowerCase() === personName.toLowerCase()
  );

  if (!existingContact) {
    const contactData = {
      name: personName,
      email: email || null,
      phone: phone || null,
      title: null,
      companyId: company.id,
      companyName: name,
      createdAt: new Date().toISOString(),
      createdBy: uid
    };
    const ref = await addDoc(collection(db, "contacts"), contactData);
    existingContact = { id: ref.id, ...contactData };
  } else {
    // Keep the directory record fresh with the latest email/phone seen,
    // but never blank out existing data with an empty value.
    const updates = {};
    if (email && email !== existingContact.email) updates.email = email;
    if (phone && phone !== existingContact.phone) updates.phone = phone;
    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, "contacts", existingContact.id), updates);
      existingContact = { ...existingContact, ...updates };

      // Someone typed a new email/phone for this person on a project or
      // pipeline entry -- push it out to every other project/pipeline
      // entry that references them too, so this isn't the only place
      // that ends up with the fresh info.
      await propagateContactUpdate({
        companyName: name,
        oldContactName: existingContact.name,
        newContactName: existingContact.name,
        email: existingContact.email,
        phone: existingContact.phone
      });
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
    if (matches(data.company, data.contact)) {
      writes.push(updateDoc(doc(db, "customers", d.id), {
        contact: newContactName,
        email: email || null,
        phone: phone || null
      }));
    }
  });

  pipelineSnap.docs.forEach(d => {
    const data = d.data();
    let payload = null;

    if (matches(data.company, data.contact)) {
      payload = { contact: newContactName, email: email || null, phone: phone || null };
    }

    const bidding = data.biddingCompanies || [];
    let biddingChanged = false;
    const newBidding = bidding.map(row => {
      if (matches(row.company, row.contact)) {
        biddingChanged = true;
        return { ...row, contact: newContactName, email: email || null, phone: phone || null };
      }
      return row;
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
