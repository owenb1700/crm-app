import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./firebaseAdmin";
import { companyKeyOf, normalizeCompanyName, sameCompany, samePerson } from "./companyMatch";
import { distinctValues } from "./directoryConflicts";

// Server-only Directory maintenance: keeping company/person names consistent
// on every project and pipeline entry when a company is renamed or
// duplicates are merged, plus the companyKeys uniqueness records. Projects
// and pipeline entries refer to firms and people by name, so these updates
// are what keep the Directory's links (and later matches) intact.

const commitInChunks = async (db, writes) => {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach(([ref, data]) => batch.update(ref, data));
    await batch.commit();
  }
};

// Every project / pipeline entry field holding a firm name in `fromNames`
// (or a spelling that normalizes the same) becomes `toName`; with
// `people`, contact names at that firm that match are renamed too.
async function rewriteRecords({ fromNames, toName, people }) {
  const db = getAdminDb();
  const isFrom = (v) => !!v && fromNames.some(n => sameCompany(n, v));
  const personTo = (name) => {
    if (!people || !name) return name;
    return people.fromNames.some(n => samePerson(n, name)) ? people.toName : name;
  };
  const firmMatchesForPeople = (v) => !people || isFrom(v);

  const [customers, pipeline] = await Promise.all([db.collection("customers").get(), db.collection("pipeline").get()]);
  const writes = [];

  customers.docs.forEach(d => {
    const c = d.data();
    const patch = {};
    if (isFrom(c.company)) {
      if (!people && c.company !== toName) patch.company = toName;
      if (people && firmMatchesForPeople(c.company) && personTo(c.contact) !== c.contact) patch.contact = personTo(c.contact);
    }
    if (!people && isFrom(c.lostTo) && c.lostTo !== toName) patch.lostTo = toName;
    if (Array.isArray(c.owners) && c.owners.some(o => isFrom(o.company))) {
      const owners = c.owners.map(o => {
        if (!isFrom(o.company)) return o;
        return people ? { ...o, contact: personTo(o.contact) } : { ...o, company: toName };
      });
      if (JSON.stringify(owners) !== JSON.stringify(c.owners)) patch.owners = owners;
    }
    if (Object.keys(patch).length) writes.push([d.ref, patch]);
  });

  pipeline.docs.forEach(d => {
    const p = d.data();
    const patch = {};
    if (isFrom(p.company)) {
      if (!people && p.company !== toName) patch.company = toName;
      if (people && personTo(p.contact) !== p.contact) patch.contact = personTo(p.contact);
    }
    if (!people) {
      if (isFrom(p.wonByContractor) && p.wonByContractor !== toName) patch.wonByContractor = toName;
      if (isFrom(p.lostTo) && p.lostTo !== toName) patch.lostTo = toName;
    }
    if (Array.isArray(p.biddingCompanies) && p.biddingCompanies.some(b => isFrom(b.company))) {
      const bidders = p.biddingCompanies.map(b => {
        if (!isFrom(b.company)) return b;
        if (!people) return { ...b, company: toName };
        const next = { ...b };
        if (b.contact) next.contact = personTo(b.contact);
        if (Array.isArray(b.contacts)) next.contacts = b.contacts.map(x => ({ ...x, name: personTo(x.name) }));
        return next;
      });
      if (JSON.stringify(bidders) !== JSON.stringify(p.biddingCompanies)) patch.biddingCompanies = bidders;
    }
    if (Object.keys(patch).length) writes.push([d.ref, patch]);
  });

  await commitInChunks(db, writes);
  return writes.length;
}

// Points a company's normalized-name key at it (creating or repairing the key).
async function setKey(db, name, companyId) {
  await db.collection("companyKeys").doc(companyKeyOf(name)).set({ companyId, name });
}

export async function renameCompany({ companyId, name }) {
  const db = getAdminDb();
  const ref = db.collection("companies").doc(companyId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("That company no longer exists");
  const oldName = snap.data().name;
  const newName = String(name || "").trim();
  if (!newName) throw new Error("Enter a company name");

  const all = await db.collection("companies").get();
  const clash = all.docs.find(d => d.id !== companyId && sameCompany(d.data().name, newName));
  if (clash) {
    const err = new Error(`"${clash.data().name}" is already in the Directory. Merge the two with Find Duplicates instead.`);
    err.status = 409;
    throw err;
  }

  await ref.update({ name: newName });
  const oldKey = db.collection("companyKeys").doc(companyKeyOf(oldName));
  const oldKeySnap = await oldKey.get();
  if (oldKeySnap.exists && oldKeySnap.data().companyId === companyId && companyKeyOf(oldName) !== companyKeyOf(newName)) {
    await oldKey.delete();
  }
  await setKey(db, newName, companyId);

  const people = await db.collection("contacts").where("companyId", "==", companyId).get();
  await commitInChunks(db, people.docs.map(d => [d.ref, { companyName: newName }]));
  const records = oldName === newName ? 0 : await rewriteRecords({ fromNames: [oldName], toName: newName });
  return { records };
}

const keepFirstNonEmpty = (keep, others, field) => keep[field] || others.map(o => o[field]).find(Boolean) || null;

// Merges people into `keepId`: every email and phone is kept (so any
// disagreement shows up as "Needs review"), and projects / pipeline entries
// that named a merged person now name the kept one.
export async function mergePeople({ keepId, mergeIds }) {
  const db = getAdminDb();
  const keepRef = db.collection("contacts").doc(keepId);
  const [keepSnap, ...mergeSnaps] = await Promise.all([keepRef, ...mergeIds.map(id => db.collection("contacts").doc(id))].map(r => r.get()));
  if (!keepSnap.exists) throw new Error("The person to keep no longer exists");
  const keep = keepSnap.data();
  const merging = mergeSnaps.filter(s => s.exists && s.data().companyId === keep.companyId).map(s => ({ id: s.id, ...s.data() }));
  if (!merging.length) return { merged: 0 };

  const all = [keep, ...merging];
  const emails = distinctValues("email", all.flatMap(p => (p.emails?.length ? p.emails : (p.email ? [p.email] : []))));
  const phones = distinctValues("phone", all.flatMap(p => (p.phones?.length ? p.phones : (p.phone ? [p.phone] : []))));
  const notes = [keep.notes, ...merging.map(p => p.notes)].filter(Boolean);

  await keepRef.update({
    emails,
    phones,
    title: keepFirstNonEmpty(keep, merging, "title"),
    notes: [...new Set(notes)].join("\n\n") || null,
    email: FieldValue.delete(),
    phone: FieldValue.delete()
  });
  await Promise.all(merging.map(p => db.collection("contacts").doc(p.id).delete()));

  const fromNames = merging.map(p => p.name).filter(n => !samePerson(n, keep.name));
  const records = fromNames.length
    ? await rewriteRecords({ fromNames: [keep.companyName], toName: keep.companyName, people: { fromNames, toName: keep.name } })
    : 0;
  return { merged: merging.length, records };
}

// Merges companies into `keepId`: people move over (identical names are
// combined), differing phone / address / website values are kept as
// alternates to review, and every project / pipeline entry naming a merged
// company now names the kept one.
export async function mergeCompanies({ keepId, mergeIds }) {
  const db = getAdminDb();
  const keepRef = db.collection("companies").doc(keepId);
  const snaps = await Promise.all([keepRef, ...mergeIds.map(id => db.collection("companies").doc(id))].map(r => r.get()));
  if (!snaps[0].exists) throw new Error("The company to keep no longer exists");
  const keep = snaps[0].data();
  const merging = snaps.slice(1).filter(s => s.exists && s.id !== keepId).map(s => ({ id: s.id, ...s.data() }));
  if (!merging.length) return { merged: 0 };

  const alternates = { ...(keep.alternates || {}) };
  ["phone", "address", "website"].forEach(field => {
    const values = distinctValues(field, [keep[field], ...(alternates[field] || []), ...merging.flatMap(m => [m[field], ...((m.alternates || {})[field] || [])])]);
    const primary = keep[field] || values[0] || null;
    alternates[field] = values.filter(v => v !== primary);
    keep[field] = primary;
  });
  const notes = [...new Set([keep.notes, ...merging.map(m => m.notes)].filter(Boolean))].join("\n\n") || null;

  const salespersonId = keep.salespersonId || merging.map(m => m.salespersonId).find(Boolean) || null;
  await keepRef.update({ phone: keep.phone, address: keep.address, website: keep.website, notes, alternates, salespersonId });

  // People move to the kept company.
  const movedSnaps = await Promise.all(merging.map(m => db.collection("contacts").where("companyId", "==", m.id).get()));
  await commitInChunks(db, movedSnaps.flatMap(s => s.docs.map(d => [d.ref, { companyId: keepId, companyName: keep.name }])));

  await Promise.all(merging.map(m => db.collection("companies").doc(m.id).delete()));
  await Promise.all(merging.map(m => setKey(db, m.name, keepId)));
  await setKey(db, keep.name, keepId);

  const records = await rewriteRecords({ fromNames: merging.map(m => m.name), toName: keep.name });

  // People with the exact same name at the kept company are the same person.
  const peopleSnap = await db.collection("contacts").where("companyId", "==", keepId).get();
  const byName = new Map();
  peopleSnap.docs.forEach(d => {
    const key = String(d.data().name || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(d.id);
  });
  let peopleCombined = 0;
  for (const ids of byName.values()) {
    if (ids.length > 1) {
      const result = await mergePeople({ keepId: ids[0], mergeIds: ids.slice(1) });
      peopleCombined += result.merged;
    }
  }

  return { merged: merging.length, records, peopleCombined };
}

// Makes sure every company has its uniqueness key (older companies were
// created before keys existed). The first company to claim a name keeps it.
export async function syncCompanyKeys() {
  const db = getAdminDb();
  const [companies, keys] = await Promise.all([db.collection("companies").get(), db.collection("companyKeys").get()]);
  const existingIds = new Set(companies.docs.map(d => d.id));
  const keyMap = new Map(keys.docs.map(d => [d.id, d.data()]));
  let created = 0;
  const sorted = [...companies.docs].sort((a, b) => String(a.data().createdAt || "").localeCompare(String(b.data().createdAt || "")));
  for (const d of sorted) {
    const name = d.data().name;
    if (!normalizeCompanyName(name)) continue;
    const key = companyKeyOf(name);
    const current = keyMap.get(key);
    if (!current || !existingIds.has(current.companyId)) {
      await setKey(db, name, d.id);
      keyMap.set(key, { companyId: d.id, name });
      created += 1;
    }
  }
  return { created };
}

// Saves part of a spreadsheet import (see lib/directoryImport.js): each firm
// is matched to an existing company by normalized name -- only filling in
// what the company is missing, never overwriting or removing what's there --
// or created with its duplicate-guard key; each person
// is matched to someone already at that firm or added. Differing addresses
// are kept for review. Everything created is tagged with `importId`.
export async function importDirectoryFirms({ firms, importId, uid }) {
  const db = getAdminDb();
  const [companiesSnap, contactsSnap] = await Promise.all([db.collection("companies").get(), db.collection("contacts").get()]);
  const companies = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const contacts = contactsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const now = new Date().toISOString();
  const ops = []; // [ref, data, "set" | "update"]
  const result = { createdFirms: 0, updatedFirms: 0, createdPeople: 0, updatedPeople: 0 };

  for (const f of firms) {
    const name = String(f.name || "").trim();
    if (!normalizeCompanyName(name)) continue;
    let company = companies.find(c => sameCompany(c.name, name));

    if (!company) {
      const ref = db.collection("companies").doc();
      const data = {
        name,
        category: f.category || "Contractor",
        phone: f.phone || null,
        address: f.address || null,
        website: f.website || null,
        notes: null,
        salespersonId: f.salespersonId || null,
        alternates: { address: distinctValues("address", f.alternateAddresses || []) },
        createdAt: now,
        createdBy: uid,
        importId
      };
      ops.push([ref, data, "set"]);
      ops.push([db.collection("companyKeys").doc(companyKeyOf(name)), { companyId: ref.id, name }, "set"]);
      company = { id: ref.id, ...data };
      companies.push(company);
      result.createdFirms += 1;
    } else {
      const alternates = { ...(company.alternates || {}) };
      const address = company.address || f.address || null;
      alternates.address = distinctValues("address", [...(alternates.address || []), f.address, ...(f.alternateAddresses || [])])
        .filter(a => distinctValues("address", [a, address]).length === 2);
      const phone = company.phone || f.phone || null;
      if (f.phone && phone && distinctValues("phone", [f.phone, phone]).length === 2) {
        alternates.phone = distinctValues("phone", [...(alternates.phone || []), f.phone]);
      }
      const patch = {
        category: company.category || f.category || "Contractor",
        address,
        phone,
        website: company.website || f.website || null,
        salespersonId: company.salespersonId || f.salespersonId || null,
        alternates
      };
      ops.push([db.collection("companies").doc(company.id), patch, "update"]);
      Object.assign(company, patch);
      result.updatedFirms += 1;
    }

    for (const person of f.people || []) {
      const existing = contacts.find(c => c.companyId === company.id && samePerson(c.name, person.name));
      if (existing) {
        const currentEmails = existing.emails?.length ? existing.emails : (existing.email ? [existing.email] : []);
        const currentPhones = existing.phones?.length ? existing.phones : (existing.phone ? [existing.phone] : []);
        const emails = distinctValues("email", [...currentEmails, ...(person.emails || [])]);
        const phones = distinctValues("phone", [...currentPhones, ...(person.phones || [])]);
        ops.push([db.collection("contacts").doc(existing.id), { emails, phones, title: existing.title || person.title || null }, "update"]);
        Object.assign(existing, { emails, phones });
        result.updatedPeople += 1;
      } else {
        const ref = db.collection("contacts").doc();
        const data = {
          name: person.name,
          title: person.title || null,
          emails: distinctValues("email", person.emails || []),
          phones: distinctValues("phone", person.phones || []),
          notes: null,
          companyId: company.id,
          companyName: company.name,
          createdAt: now,
          createdBy: uid,
          importId
        };
        ops.push([ref, data, "set"]);
        contacts.push({ id: ref.id, ...data });
        result.createdPeople += 1;
      }
    }
  }

  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach(([ref, data, kind]) => (kind === "set" ? batch.set(ref, data) : batch.update(ref, data)));
    await batch.commit();
  }
  return result;
}
