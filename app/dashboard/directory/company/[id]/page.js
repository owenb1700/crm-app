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
import { COMPANY_CATEGORIES, propagateContactUpdate } from "../../../../../lib/directory";
import DashboardHeader from "../../../../components/DashboardHeader";

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

  const formatPhone = (phone) => {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return phone;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const loadCompany = async () => {
    const snap = await getDoc(doc(db, "companies", companyId));
    if (!snap.exists()) {
      setNotFound(true);
      return;
    }
    const data = { id: snap.id, ...snap.data() };
    setCompany(data);

    const [peopleSnap, customersSnap, pipelineSnap] = await Promise.all([
      getDocs(query(collection(db, "contacts"), where("companyId", "==", companyId))),
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline"))
    ]);

    setPeople(peopleSnap.docs.map(d => ({ id: d.id, ...d.data() })));

    const name = (data.name || "").toLowerCase();
    setProjects(
      customersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c =>
          (c.company || "").toLowerCase() === name ||
          (c.owners || []).some(o => (o.company || "").toLowerCase() === name)
        )
    );
    setPipelineJobs(
      pipelineSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p =>
          (p.company || "").toLowerCase() === name ||
          (p.biddingCompanies || []).some(b => (b.company || "").toLowerCase() === name)
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
      notes: company.notes || ""
    });
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!editData.name) return alert("Company name is required");

    await updateDoc(doc(db, "companies", companyId), {
      name: editData.name,
      category: editData.category,
      phone: editData.phone || null,
      address: editData.address || null,
      website: editData.website || null,
      notes: editData.notes || null
    });

    setIsEditing(false);
    await loadCompany();
  };

  const deleteCompany = async () => {
    if (!window.confirm(`Delete ${company.name}? This also removes all ${people.length} people on file for them. Projects and pipeline entries that reference them are kept.`)) {
      return;
    }

    await Promise.all(people.map(p => deleteDoc(doc(db, "contacts", p.id))));
    await deleteDoc(doc(db, "companies", companyId));

    router.push("/dashboard/directory");
  };

  const addPerson = async () => {
    if (!personName.trim()) return alert("Enter a name");

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

  const savePerson = async () => {
    if (!personEditData.name.trim()) return alert("Enter a name");

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
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

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
                <button className="btn btn-primary" onClick={saveEdit}>Save</button>
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

            <h4 className="field-label">Phone</h4>
            <input className="field" autoComplete="off" value={editData.phone} onChange={e => setEditData({ ...editData, phone: e.target.value })} />

            <h4 className="field-label">Address</h4>
            <input className="field" autoComplete="off" value={editData.address} onChange={e => setEditData({ ...editData, address: e.target.value })} />

            <h4 className="field-label">Website</h4>
            <input className="field" autoComplete="off" value={editData.website} onChange={e => setEditData({ ...editData, website: e.target.value })} />

            <h4 className="field-label">Notes</h4>
            <textarea className="field" style={{ width: "100%", height: 80 }} value={editData.notes} onChange={e => setEditData({ ...editData, notes: e.target.value })} />
          </div>
        ) : (
          <div className="project-section">
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
                    <button className="btn btn-primary" onClick={savePerson}>Save</button>
                    <button className="btn btn-secondary" onClick={() => setEditingPersonId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div><strong>{p.name}</strong>{p.title ? ` — ${p.title}` : ""}</div>
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
                <button className="btn btn-primary" onClick={addPerson}>Add</button>
                <button className="btn btn-secondary" onClick={() => setShowAddPerson(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="project-section">
          <h4 className="field-label">Projects ({projects.length})</h4>
          {projects.length === 0 && <p className="private-note-hint">No projects with this company yet.</p>}
          {projects.map(p => (
            <div key={p.id} className="notes-history-item" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/project/${p.id}`)}>
              <div><strong>{p.projectName || p.company}</strong></div>
              <div className="notes-history-date">Next: {p.nextCheckIn || "—"}{p.category ? ` · ${p.category}` : ""}</div>
            </div>
          ))}
        </div>

        <div className="project-section">
          <h4 className="field-label">Pipeline Entries ({pipelineJobs.length})</h4>
          {pipelineJobs.length === 0 && <p className="private-note-hint">No pipeline entries with this company yet.</p>}
          {pipelineJobs.map(p => (
            <div key={p.id} className="notes-history-item" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/pipeline/${p.id}`)}>
              <div><strong>{p.title}</strong></div>
              <div className="notes-history-date">{p.stage}{p.bidDate ? ` · Bid: ${p.bidDate}` : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
