"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../../../lib/firebase";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc
} from "firebase/firestore";
import { COMPANY_CATEGORIES, propagateContactUpdate, directoryAction, firmTagsOf, firmTagLabel } from "../../../../../lib/directory";
import DashboardHeader from "../../../../components/DashboardHeader";
import AddressAutocomplete from "../../../../components/AddressAutocomplete";
import MobileNav from "../../../../components/MobileNav";
import { isTrashed } from "../../../../../lib/trash";
import { companyKeyOf, sameCompany, samePerson, findSimilarPeople, findSimilarCompanies } from "../../../../../lib/companyMatch";
import { companyConflicts, personConflicts, describeConflicts, reviewSignature, emailsOf, phonesOf, companyValues, FIELD_LABELS } from "../../../../../lib/directoryConflicts";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import SalespersonSelect from "../../../../components/SalespersonSelect";
import FirmTagPicker from "../../../../components/FirmTagPicker";
import { historyForFirm } from "../../../../../lib/firmHistory";
import { addressKey } from "../../../../../lib/addresses";
import { withDollar } from "../../../../../lib/analytics";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const clearSession = () => {
  localStorage.removeItem("loginTimestamp");
};

// A person can have several emails or phone numbers on file. Renders one
// input per value plus an "add another" link; always keeps at least one
// (blank) row so there's somewhere to type the first value.
function MultiField({ label, type = "text", values, onChange }) {
  const list = values.length ? values : [""];

  const update = (i, v) => {
    const next = [...list];
    next[i] = v;
    onChange(next);
  };

  const remove = (i) => {
    const next = list.filter((_, idx) => idx !== i);
    onChange(next.length ? next : [""]);
  };

  return (
    <div>
      <label className="field-label">{label}</label>
      {list.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input
            className="field"
            style={{ marginBottom: 0 }}
            type={type}
            autoComplete="off"
            value={v}
            onChange={e => update(i, e.target.value)}
          />
          {list.length > 1 && (
            <button type="button" className="btn btn-secondary" onClick={() => remove(i)}>×</button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="link-muted"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13 }}
        onClick={() => onChange([...list, ""])}
      >
        + Add another {label.toLowerCase()}
      </button>
    </div>
  );
}

export default function CompanyDetail() {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id;

  const [uid, setUid] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [company, setCompany] = useState(null);
  const [people, setPeople] = useState([]);
  const [parts, setParts] = useState([]);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [pipelineJobs, setPipelineJobs] = useState([]);

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});

  const [showAddPerson, setShowAddPerson] = useState(false);
  const [personName, setPersonName] = useState("");
  const [personTitle, setPersonTitle] = useState("");
  const [personEmails, setPersonEmails] = useState([""]);
  const [personPhones, setPersonPhones] = useState([""]);
  const [personNotes, setPersonNotes] = useState("");

  const [editingPersonId, setEditingPersonId] = useState(null);
  const [personEditData, setPersonEditData] = useState({});

  // A name check waiting on the user: { kind: "company" | "person", message, onContinue }
  const [nameCheck, setNameCheck] = useState(null);
  // Needs-review window: { target: "company" | person, choices: { field: value | "__all" } }
  const [review, setReview] = useState(null);
  const [savingReview, setSavingReview] = useState(false);
  const [saving, setSaving] = useState(false);

  const formatPhone = (phone) => {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return phone;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const historyRows = (name) => historyForFirm({ firmName: name, projects, pipeline: pipelineJobs, parts });
  const personIdFor = (name) => people.find(p => samePerson(p.name, name))?.id;

  const loadCompany = async () => {
    const snap = await getDoc(doc(db, "companies", companyId));
    if (!snap.exists()) {
      setNotFound(true);
      return;
    }
    const data = { id: snap.id, ...snap.data() };
    setCompany(data);

    const [peopleSnap, customersSnap, pipelineSnap, usersSnap, partsSnap] = await Promise.all([
      getDocs(query(collection(db, "contacts"), where("companyId", "==", companyId))),
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, "parts"))
    ]);
    setParts(partsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));

    setPeople(peopleSnap.docs.map(d => ({ id: d.id, ...d.data() })));

    setProjects(
      customersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => !isTrashed(r))
        .filter(c =>
          sameCompany(c.company, data.name) ||
          (c.owners || []).some(o => sameCompany(o.company, data.name))
        )
    );
    setPipelineJobs(
      pipelineSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => !isTrashed(r))
        .filter(p =>
          sameCompany(p.company, data.name) ||
          (p.biddingCompanies || []).some(b => sameCompany(b.company, data.name))
        )
    );
  };

  useEffect(() => {
    let timer;

    const unsub = onAuthStateChanged(auth, async (user) => {
      const loginTimestamp = Number(localStorage.getItem("loginTimestamp") || 0);
      const elapsed = Date.now() - loginTimestamp;

      if (!user || !loginTimestamp || elapsed > SESSION_LENGTH_MS) {
        clearSession();
        signOut(auth);
        router.push("/");
        return;
      }

      timer = setTimeout(() => {
        clearSession();
        signOut(auth);
        router.push("/");
      }, SESSION_LENGTH_MS - elapsed);

      setUid(user.uid);

      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        if (!profileSnap.exists()) {
          router.push("/dashboard");
          return;
        }
        if (profileSnap.data().disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }

        setIsAdmin(profileSnap.data().role === "admin");

        await loadCompany();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this company.");
      }
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const startEdit = () => {
    setEditData({
      name: company.name || "",
      category: company.category || "Contractor",
      phone: company.phone || "",
      address: company.address || "",
      website: company.website || "",
      notes: company.notes || "",
      salespersonId: company.salespersonId || "",
      workTypes: Array.isArray(company.workTypes) ? company.workTypes : [],
      sectors: Array.isArray(company.sectors) ? company.sectors : []
    });
    setIsEditing(true);
  };

  // Renaming goes through the server so every project and pipeline entry
  // naming this firm is renamed too; a name already used by another firm is
  // refused (merge them instead) and a similar one asks first.
  const saveEdit = async (force = false) => {
    const name = (editData.name || "").trim();
    if (!name) return alert("Company name is required");
    const renamed = name !== company.name;

    if (renamed && !force) {
      const others = (await getDocs(collection(db, "companies"))).docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.id !== companyId);
      const same = others.find(c => sameCompany(c.name, name));
      if (same) {
        return alert(`"${same.name}" is already in the Directory. ${isAdmin ? "Use Find Duplicates to merge the two." : "Ask an admin to merge the two."}`);
      }
      const similar = findSimilarCompanies(others, name);
      if (similar.length) {
        return setNameCheck({
          message: `${similar.map(c => `"${c.name}"`).join(" and ")} ${similar.length === 1 ? "is" : "are"} already in the Directory. Rename this company to "${name}" anyway?`,
          confirmLabel: "Rename anyway",
          onContinue: () => { setNameCheck(null); saveEdit(true); }
        });
      }
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, "companies", companyId), {
        category: editData.category,
        phone: editData.phone || null,
        address: editData.address || null,
        website: editData.website || null,
        notes: editData.notes || null,
        salespersonId: editData.salespersonId || null,
        // Kept apart so switching a firm's category doesn't wipe what was
        // ticked under the other one.
        workTypes: editData.workTypes || [],
        sectors: editData.sectors || []
      });
      if (renamed) await directoryAction("renameCompany", { companyId, name });
      setIsEditing(false);
      await loadCompany();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteCompany = async () => {
    if (!window.confirm(`Delete ${company.name}? This also removes all ${people.length} people on file for them. Projects and pipeline entries that reference them are kept.`)) {
      return;
    }

    await Promise.all(people.map(p => deleteDoc(doc(db, "contacts", p.id))));
    await deleteDoc(doc(db, "companies", companyId));
    try {
      const keyRef = doc(db, "companyKeys", companyKeyOf(company.name));
      const keySnap = await getDoc(keyRef);
      if (keySnap.exists() && keySnap.data().companyId === companyId) await deleteDoc(keyRef);
    } catch {
      // The key is only a guard against duplicates; a stale one is repaired automatically.
    }

    router.push("/dashboard/directory");
  };

  const addPerson = async (force = false) => {
    if (!personName.trim()) return alert("Enter a name");
    const same = people.find(p => samePerson(p.name, personName));
    if (same) return alert(`${same.name} is already listed at ${company.name}. Edit their entry to add details.`);
    const similar = findSimilarPeople(people, personName);
    if (similar.length && !force) {
      return setNameCheck({
        message: `${similar.map(p => p.name).join(" and ")} ${similar.length === 1 ? "is" : "are"} already listed at ${company.name}. Is "${personName.trim()}" someone else?`,
        confirmLabel: "Yes, add them",
        onContinue: () => { setNameCheck(null); addPerson(true); }
      });
    }

    await addDoc(collection(db, "contacts"), {
      name: personName.trim(),
      title: personTitle || null,
      emails: personEmails.map(e => e.trim()).filter(Boolean),
      phones: personPhones.map(p => p.trim()).filter(Boolean),
      notes: personNotes || null,
      companyId,
      companyName: company.name,
      createdAt: new Date().toISOString(),
      createdBy: uid
    });

    setPersonName("");
    setPersonTitle("");
    setPersonEmails([""]);
    setPersonPhones([""]);
    setPersonNotes("");
    setShowAddPerson(false);
    await loadCompany();
  };

  const startEditPerson = (p) => {
    setEditingPersonId(p.id);
    setPersonEditData({
      name: p.name || "",
      title: p.title || "",
      emails: p.emails?.length ? p.emails : (p.email ? [p.email] : [""]),
      phones: p.phones?.length ? p.phones : (p.phone ? [p.phone] : [""]),
      notes: p.notes || ""
    });
  };

  const savePerson = async (force = false) => {
    if (!personEditData.name.trim()) return alert("Enter a name");
    const others = people.filter(p => p.id !== editingPersonId);
    const same = others.find(p => samePerson(p.name, personEditData.name));
    if (same) return alert(`${same.name} is already listed at ${company.name}.`);
    const similar = findSimilarPeople(others, personEditData.name);
    if (similar.length && !force) {
      return setNameCheck({
        message: `${similar.map(p => p.name).join(" and ")} ${similar.length === 1 ? "is" : "are"} already listed at ${company.name}. Save "${personEditData.name.trim()}" as a different person?`,
        confirmLabel: "Save anyway",
        onContinue: () => { setNameCheck(null); savePerson(true); }
      });
    }

    const before = people.find(p => p.id === editingPersonId);
    const oldName = before?.name || "";

    const emails = (personEditData.emails || []).map(e => e.trim()).filter(Boolean);
    const phones = (personEditData.phones || []).map(p => p.trim()).filter(Boolean);

    await updateDoc(doc(db, "contacts", editingPersonId), {
      name: personEditData.name,
      title: personEditData.title || null,
      emails,
      phones,
      notes: personEditData.notes || null
    });

    // Push the update out to every project/pipeline entry (including
    // bidding rows) that already captured this person, so they stop
    // showing a stale snapshot of the old name/email/phone. Those entries
    // only hold a single email/phone each, so they get the primary one.
    await propagateContactUpdate({
      companyName: company.name,
      oldContactName: oldName,
      newContactName: personEditData.name,
      email: emails[0] || null,
      phone: phones[0] || null
    });

    setEditingPersonId(null);
    setPersonEditData({});
    await loadCompany();
  };

  const openReview = (target) => {
    const conflicts = target === "company" ? companyConflicts(company) : personConflicts(target);
    setReview({ target, conflicts, choices: Object.fromEntries(conflicts.map(c => [c.field, c.values[0]])) });
  };

  // Picking one value keeps just that one; "all correct" keeps every value
  // and remembers that this exact set was confirmed.
  const saveReview = async () => {
    setSavingReview(true);
    try {
      if (review.target === "company") {
        const patch = { alternates: { ...(company.alternates || {}) }, reviewed: { ...(company.reviewed || {}) } };
        review.conflicts.forEach(({ field, values }) => {
          const choice = review.choices[field];
          if (choice === "__all") {
            patch.reviewed[field] = reviewSignature(field, values);
          } else {
            patch[field] = choice;
            patch.alternates[field] = [];
          }
        });
        await updateDoc(doc(db, "companies", companyId), patch);
      } else {
        const person = review.target;
        const patch = { reviewed: { ...(person.reviewed || {}) } };
        review.conflicts.forEach(({ field, values }) => {
          const choice = review.choices[field];
          const key = field === "phone" ? "phones" : "emails";
          if (choice === "__all") {
            patch.reviewed[field] = reviewSignature(field, values);
          } else {
            patch[key] = [choice];
          }
        });
        await updateDoc(doc(db, "contacts", person.id), patch);
        const emails = patch.emails || emailsOf(person);
        const phones = patch.phones || phonesOf(person);
        await propagateContactUpdate({
          companyName: company.name,
          oldContactName: person.name,
          newContactName: person.name,
          email: emails[0] || null,
          phone: phones[0] || null
        });
      }
      setReview(null);
      await loadCompany();
    } catch (err) {
      alert(`Couldn't save: ${err.message}`);
    } finally {
      setSavingReview(false);
    }
  };

  const companyReviewNeeded = company ? companyConflicts(company) : [];

  const deletePerson = async (personId) => {
    if (!window.confirm("Delete this person from the directory?")) return;
    await deleteDoc(doc(db, "contacts", personId));
    await loadCompany();
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load this company</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }

  const history = company ? historyRows(company.name) : [];

  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Company not found</h3>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>Back to Directory</button>
        </div>
      </div>
    );
  }

  if (!company) {
    return <div className="dashboard-page">Loading...</div>;
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">{company.category || "Company"}</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>← Back to Directory</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <h2 className="modal-title" style={{ marginBottom: 2 }}>{company.name}</h2>
              <span className="role-badge role-badge-admin" style={{ marginTop: 6 }}>{company.category}</span>
            </div>
            {!isEditing && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={startEdit}>Edit</button>
                {isAdmin && (
                  <button className="btn btn-danger" onClick={deleteCompany}>Delete</button>
                )}
              </div>
            )}
            {isEditing && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" disabled={saving} onClick={() => saveEdit(false)}>{saving ? "Saving…" : "Save"}</button>
                <button className="btn btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="project-section">
            <h4 className="field-label">Name</h4>
            <input className="field" autoComplete="off" value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} />

            <h4 className="field-label">Category</h4>
            <select className="field" value={editData.category} onChange={e => setEditData({ ...editData, category: e.target.value })}>
              {COMPANY_CATEGORIES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>

            <FirmTagPicker
              idPrefix="company-tag"
              category={editData.category}
              value={editData.category === "Contractor" ? editData.workTypes : editData.sectors}
              onChange={tags => setEditData(prev => (
                prev.category === "Contractor" ? { ...prev, workTypes: tags } : { ...prev, sectors: tags }
              ))}
            />

            <SalespersonSelect
              id="company-salesperson"
              users={users}
              label="Assigned Salesperson (optional)"
              value={editData.salespersonId}
              onChange={v => setEditData({ ...editData, salespersonId: v })}
              optional
            />
            <p className="private-note-hint" style={{ marginTop: -4 }}>Filled in automatically when this firm is chosen on a pipeline entry; it can still be changed there.</p>

            <h4 className="field-label">Phone</h4>
            <input className="field" autoComplete="off" value={editData.phone} onChange={e => setEditData({ ...editData, phone: e.target.value })} />

            <h4 className="field-label">Address</h4>
            <AddressAutocomplete id="company-edit-address" name="company-edit-address" placeholder="Company Address" value={editData.address} onChange={v => setEditData({ ...editData, address: v })} />

            <h4 className="field-label">Website</h4>
            <input className="field" autoComplete="off" value={editData.website} onChange={e => setEditData({ ...editData, website: e.target.value })} />

            <h4 className="field-label">Notes</h4>
            <textarea className="field" style={{ width: "100%", height: 80 }} value={editData.notes} onChange={e => setEditData({ ...editData, notes: e.target.value })} />
          </div>
        ) : (
          <div className="project-section">
            {companyReviewNeeded.length > 0 && (
              <div className="review-banner">
                <span>⚠ Needs review: {describeConflicts(companyReviewNeeded)} on file.</span>
                <button type="button" className="btn btn-secondary" onClick={() => openReview("company")}>Review</button>
              </div>
            )}
            <p><strong>Assigned Salesperson:</strong> {(() => {
              const u = users.find(x => x.id === company.salespersonId);
              return u ? (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email) : "—";
            })()}</p>
            <p><strong>{firmTagLabel(company.category)}:</strong> {firmTagsOf(company).join(", ") || "—"}</p>
            <p><strong>Phone:</strong> {formatPhone(company.phone) || "—"}</p>
            <p><strong>Address:</strong> {company.address || "—"}</p>
            <p><strong>Website:</strong> {company.website || "—"}</p>
            {company.notes && <p><strong>Notes:</strong> {company.notes}</p>}
          </div>
        )}

        <div className="project-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 className="field-label" style={{ margin: 0 }}>People ({people.length})</h4>
            <button className="btn btn-secondary" onClick={() => setShowAddPerson(true)}>+ Add Person</button>
          </div>

          {people.length === 0 && <p className="private-note-hint" style={{ marginTop: 10 }}>No one added yet.</p>}

          {people.map(p => (
            <div key={p.id} className="notes-history-item notes-history-row" style={{ marginTop: 10 }}>
              {editingPersonId === p.id ? (
                <div style={{ flex: 1 }}>
                  <input className="field" placeholder="Name" autoComplete="off" value={personEditData.name} onChange={e => setPersonEditData({ ...personEditData, name: e.target.value })} />
                  <input className="field" placeholder="Title" autoComplete="off" value={personEditData.title} onChange={e => setPersonEditData({ ...personEditData, title: e.target.value })} />
                  <MultiField label="Email" type="email" values={personEditData.emails || [""]} onChange={emails => setPersonEditData({ ...personEditData, emails })} />
                  <MultiField label="Phone" type="tel" values={personEditData.phones || [""]} onChange={phones => setPersonEditData({ ...personEditData, phones })} />
                  <textarea className="field" placeholder="Notes" style={{ width: "100%", height: 60 }} value={personEditData.notes} onChange={e => setPersonEditData({ ...personEditData, notes: e.target.value })} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => savePerson(false)}>Save</button>
                    <button className="btn btn-secondary" onClick={() => setEditingPersonId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div>
                      {/* Their own page: notes, and every job they've been
                          named on. */}
                      <button
                        type="button"
                        className="link-muted matching-select-link"
                        style={{ font: "inherit", fontWeight: 700, padding: 0 }}
                        onClick={() => router.push(`/dashboard/directory/person/${p.id}`)}
                      >
                        {p.name}
                      </button>
                      {p.title ? ` — ${p.title}` : ""}
                      {personConflicts(p).length > 0 && (
                        <button type="button" className="review-flag review-flag-button" title="Different information is on file -- confirm which is correct" onClick={() => openReview(p)}>
                          ⚠ {describeConflicts(personConflicts(p))} — review
                        </button>
                      )}
                    </div>
                    {(() => {
                      const emails = p.emails?.length ? p.emails : (p.email ? [p.email] : []);
                      const phones = p.phones?.length ? p.phones : (p.phone ? [p.phone] : []);
                      if (emails.length === 0 && phones.length === 0) {
                        return <div className="notes-history-date">No contact info</div>;
                      }
                      return (
                        <div className="notes-history-date">
                          {emails.map((e, i) => <div key={`e${i}`}>{e}</div>)}
                          {phones.map((ph, i) => <div key={`p${i}`}>{formatPhone(ph)}</div>)}
                        </div>
                      );
                    })()}
                    {p.notes && <div className="notes-history-date" style={{ marginTop: 4 }}>{p.notes}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => router.push(`/dashboard/directory/person/${p.id}`)}>History</button>
                    <button className="btn btn-secondary" onClick={() => startEditPerson(p)}>Edit</button>
                    <button className="btn btn-danger" onClick={() => deletePerson(p.id)}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}

          {showAddPerson && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--color-border)" }}>
              <input className="field" placeholder="Name" autoComplete="off" value={personName} onChange={e => setPersonName(e.target.value)} />
              <input className="field" placeholder="Title" autoComplete="off" value={personTitle} onChange={e => setPersonTitle(e.target.value)} />
              <MultiField label="Email" type="email" values={personEmails} onChange={setPersonEmails} />
              <MultiField label="Phone" type="tel" values={personPhones} onChange={setPersonPhones} />
              <textarea className="field" placeholder="Notes" style={{ width: "100%", height: 60 }} value={personNotes} onChange={e => setPersonNotes(e.target.value)} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={() => addPerson(false)}>Add</button>
                <button className="btn btn-secondary" onClick={() => setShowAddPerson(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="project-section detail-span-full">
          <h4 className="field-label">Work with {company.name} ({history.length})</h4>
          <p className="private-note-hint">
            Every project, pipeline entry and parts request this firm is on -- as the contractor, a building owner,
            a bidder, or the contractor on someone's parts. Each row says who there was involved and where the job was.
          </p>
          {history.length === 0 ? (
            <p className="private-note-hint">Nothing on file with them yet.</p>
          ) : (
            <div className="analytics-table-wrap">
              <table className="analytics-table stack-on-phone">
                <thead>
                  <tr>
                    <th>What</th>
                    <th>Type</th>
                    <th>Their role</th>
                    <th>Person</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Value</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(row => (
                    <tr key={`${row.kind}-${row.id}`} style={{ cursor: "pointer" }} onClick={() => router.push(row.href)}>
                      <td data-label="What">{row.name}</td>
                      <td data-label="Type">{row.kind}</td>
                      <td data-label="Their role">{row.role}</td>
                      <td data-label="Person">
                        {row.person
                          ? (personIdFor(row.person)
                            ? <button type="button" className="link-muted matching-select-link" onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/directory/person/${personIdFor(row.person)}`); }}>{row.person}</button>
                            : row.person)
                          : "—"}
                      </td>
                      <td data-label="Address">
                        {row.address
                          ? <button type="button" className="link-muted matching-select-link" onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/directory/address/${addressKey(row.address)}`); }}>{row.address}</button>
                          : "—"}
                      </td>
                      <td data-label="Status">{row.status || "—"}</td>
                      <td data-label="Value">{withDollar(row.value) || "—"}</td>
                      <td data-label="Date">{row.date || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {nameCheck && (
        <ConfirmDialog
          title="Possible duplicate"
          confirmLabel={nameCheck.confirmLabel}
          onCancel={() => setNameCheck(null)}
          onConfirm={nameCheck.onContinue}
        >
          <p>{nameCheck.message}</p>
        </ConfirmDialog>
      )}

      {review && (
        <div className="modal-overlay">
          <div className="modal-card review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <h3 id="review-title" className="modal-title">
              Review {review.target === "company" ? company.name : review.target.name}
            </h3>
            <p className="modal-subtitle">Different information is on file. Pick the correct one, or confirm they&apos;re all correct.</p>
            {review.conflicts.map(({ field, values }) => (
              <fieldset key={field} className="review-field">
                <legend className="field-label">{FIELD_LABELS[field][0].toUpperCase() + FIELD_LABELS[field].slice(1)}</legend>
                {values.map(v => (
                  <label key={v} className="settings-check" htmlFor={`review-${field}-${v}`}>
                    <input
                      id={`review-${field}-${v}`}
                      type="radio"
                      name={`review-${field}`}
                      checked={review.choices[field] === v}
                      onChange={() => setReview({ ...review, choices: { ...review.choices, [field]: v } })}
                    />
                    <span>{field === "phone" ? formatPhone(v) : v}</span>
                  </label>
                ))}
                <label className="settings-check" htmlFor={`review-${field}-all`}>
                  <input
                    id={`review-${field}-all`}
                    type="radio"
                    name={`review-${field}`}
                    checked={review.choices[field] === "__all"}
                    onChange={() => setReview({ ...review, choices: { ...review.choices, [field]: "__all" } })}
                  />
                  <span>All of these are correct — keep them all</span>
                </label>
              </fieldset>
            ))}
            <p className="private-note-hint">Picking one removes the others{review.target === "company" ? "" : " and updates projects and pipeline entries that list this person"}.</p>
            <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" disabled={savingReview} onClick={() => setReview(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={savingReview} onClick={saveReview}>{savingReview ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}