"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { COMPANY_CATEGORIES, ensureCompanyAndContactBatch } from "../../../lib/directory";
import { PART_STAGES, blankPart, partPayload, partError, filterParts, sortParts, partsTotal } from "../../../lib/parts";
import { formatMoney } from "../../../lib/analytics";
import { personName } from "../../../lib/people";
import { downloadTable, csvDateStamp } from "../../../lib/csv";
import { FirmSelect, PersonSelect, peopleAtFirm, findPerson } from "../../components/DirectoryPickers";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNav from "../../components/MobileNav";
import ViewTabs from "../../components/ViewTabs";
import ExportButtons from "../../components/ExportButtons";
import MoneyInput from "../../components/MoneyInput";
import ConfirmDialog from "../../components/ConfirmDialog";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const clearSession = () => localStorage.removeItem("loginTimestamp");

// Parts: small jobs -- a coil, a fan motor, a strainer basket -- quoted or
// sold to a contractor, building owner, or engineering firm. They used to
// be a project category, which buried them in everyone's My Projects; now
// they're their own list that the whole team shares.
function PartsPageContent() {
  const router = useRouter();

  const [uid, setUid] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [role, setRole] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [parts, setParts] = useState([]);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);

  const [form, setForm] = useState(blankPart());
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(blankPart());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [filters, setFilters] = useState({ search: "", stage: "", category: "", firm: "", person: "" });

  const load = async () => {
    const [partsSnap, usersSnap, companiesSnap, contactsSnap] = await Promise.all([
      getDocs(collection(db, "parts")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts"))
    ]);
    setParts(partsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setLoaded(true);
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
        if (!profileSnap.exists() || profileSnap.data().disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }
        setMyProfile(profileSnap.data());
        setRole(profileSnap.data().role);
        await load();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading parts.");
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (id) => (id ? personName(users.find(u => u.id === id)) : "");

  // Picking a person at the firm fills in their email and phone, the same
  // way the project and pipeline forms do.
  const applyContact = (setter, value) => {
    setter(prev => {
      const person = findPerson(peopleAtFirm(contacts, prev.company, companies), value);
      return {
        ...prev,
        contact: value,
        email: person?.email || prev.email,
        phone: person?.phone || prev.phone
      };
    });
  };

  const save = async () => {
    const message = partError(form);
    if (message) return setError(message);
    setSaving(true);
    setError("");
    try {
      const payload = partPayload(form);
      await addDoc(collection(db, "parts"), {
        ...payload,
        ownerId: uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: uid
      });
      // A firm or person typed here joins the Directory, so parts work
      // builds the same contact list as everything else.
      await ensureCompanyAndContactBatch(
        [{ companyName: payload.company, category: payload.companyCategory, contactName: payload.contact, email: payload.email, phone: payload.phone }],
        { companies, contacts, uid }
      );
      setForm(blankPart());
      setAdding(false);
      setNotice("Parts entry added");
      await load();
    } catch (err) {
      setError(`Couldn't save this parts entry: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditForm({ ...blankPart(), ...p });
    setError("");
  };

  const saveEdit = async () => {
    const message = partError(editForm);
    if (message) return setError(message);
    setSaving(true);
    setError("");
    try {
      const payload = partPayload(editForm);
      await updateDoc(doc(db, "parts", editingId), {
        ...payload,
        updatedAt: new Date().toISOString(),
        updatedBy: uid
      });
      await ensureCompanyAndContactBatch(
        [{ companyName: payload.company, category: payload.companyCategory, contactName: payload.contact, email: payload.email, phone: payload.phone }],
        { companies, contacts, uid }
      );
      setEditingId(null);
      setNotice("Parts entry updated");
      await load();
    } catch (err) {
      setError(`Couldn't save this parts entry: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    try {
      await deleteDoc(doc(db, "parts", p.id));
      setParts(prev => prev.filter(x => x.id !== p.id));
      setConfirmDelete(null);
      setNotice("Parts entry deleted");
    } catch (err) {
      setError(`Couldn't delete this parts entry: ${err.message}`);
    }
  };

  const shown = useMemo(() => sortParts(filterParts(parts, filters)), [parts, filters]);
  const anyFilter = Object.values(filters).some(Boolean);

  const exportParts = (format) => downloadTable({
    format,
    filename: `parts${anyFilter ? "-filtered" : ""}-${csvDateStamp()}`,
    sheetName: "Parts",
    headers: ["Part", "Stage", "Firm type", "Firm", "Contact", "Email", "Phone", "Value", "Needed by", "Notes", "Entered by", "Added", "Last updated by"],
    rows: shown.map(p => [
      p.item, p.stage, p.companyCategory, p.company, p.contact, p.email, p.phone,
      p.value, p.neededBy, p.notes, nameOf(p.ownerId),
      String(p.createdAt || "").slice(0, 10), nameOf(p.updatedBy)
    ])
  });

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load parts</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }

  const partForm = (values, setValues, idPrefix) => (
    <>
      <div className="form-grid-2">
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-item`}>Part</label>
          <input
            id={`${idPrefix}-item`}
            className="field"
            autoComplete="off"
            placeholder="e.g. Replacement fan motor"
            value={values.item}
            onChange={e => setValues(prev => ({ ...prev, item: e.target.value }))}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-stage`}>Stage</label>
          <select
            id={`${idPrefix}-stage`}
            className="field"
            value={values.stage}
            onChange={e => setValues(prev => ({ ...prev, stage: e.target.value }))}
          >
            {PART_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-type`}>Firm type</label>
          <select
            id={`${idPrefix}-type`}
            className="field"
            value={values.companyCategory}
            onChange={e => setValues(prev => ({ ...prev, companyCategory: e.target.value }))}
          >
            {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-firm`}>{values.companyCategory}</label>
          <FirmSelect
            id={`${idPrefix}-firm`}
            companies={companies}
            category={values.companyCategory}
            value={values.company}
            onChange={v => setValues(prev => ({ ...prev, company: v }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-contact`}>Contact</label>
          <PersonSelect
            id={`${idPrefix}-contact`}
            people={peopleAtFirm(contacts, values.company, companies)}
            value={values.contact}
            onChange={v => applyContact(setValues, v)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-value`}>Value</label>
          <MoneyInput
            id={`${idPrefix}-value`}
            placeholder="e.g. 4,200"
            value={values.value}
            onChange={v => setValues(prev => ({ ...prev, value: v }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-email`}>Email</label>
          <input id={`${idPrefix}-email`} className="field" autoComplete="off" value={values.email} onChange={e => setValues(prev => ({ ...prev, email: e.target.value }))} />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-phone`}>Phone</label>
          <input id={`${idPrefix}-phone`} className="field" autoComplete="off" value={values.phone} onChange={e => setValues(prev => ({ ...prev, phone: e.target.value }))} />
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-needed`}>Needed by</label>
          <input id={`${idPrefix}-needed`} className="field" type="date" value={values.neededBy} onChange={e => setValues(prev => ({ ...prev, neededBy: e.target.value }))} />
        </div>
      </div>

      <label className="field-label" htmlFor={`${idPrefix}-notes`}>Notes</label>
      <textarea
        id={`${idPrefix}-notes`}
        className="field"
        style={{ width: "100%", height: 70 }}
        value={values.notes}
        onChange={e => setValues(prev => ({ ...prev, notes: e.target.value }))}
      />
    </>
  );

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} profile={myProfile ? { ...myProfile, role } : null} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Parts</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>← Back to My Projects</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      {myProfile
        ? <ViewTabs profile={{ ...myProfile, role }} role={role} view="parts" searchData={{}} />
        : (
          <div className="view-tabs" aria-hidden="true">
            <button className="tab-btn" style={{ visibility: "hidden" }} tabIndex={-1}>Home</button>
          </div>
        )}

      {!loaded ? (
        <p className="modal-subtitle">Loading parts...</p>
      ) : (
        <>
          <div className="list-toolbar">
            <input
              className="field"
              style={{ maxWidth: 260, marginBottom: 0 }}
              placeholder="Search parts..."
              aria-label="Search parts"
              value={filters.search}
              onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
            />
            <select className="field" style={{ maxWidth: 170, marginBottom: 0 }} aria-label="Stage" value={filters.stage} onChange={e => setFilters(prev => ({ ...prev, stage: e.target.value }))}>
              <option value="">All stages</option>
              {PART_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="field" style={{ maxWidth: 210, marginBottom: 0 }} aria-label="Firm type" value={filters.category} onChange={e => setFilters(prev => ({ ...prev, category: e.target.value }))}>
              <option value="">All firm types</option>
              {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="field" style={{ maxWidth: 200, marginBottom: 0 }} aria-label="Entered by" value={filters.person} onChange={e => setFilters(prev => ({ ...prev, person: e.target.value }))}>
              <option value="">Anyone</option>
              {users.filter(u => !u.disabled).sort((a, b) => personName(a).localeCompare(personName(b))).map(u => (
                <option key={u.id} value={u.id}>{personName(u)}</option>
              ))}
            </select>
            {anyFilter && (
              <button className="btn btn-secondary" onClick={() => setFilters({ search: "", stage: "", category: "", firm: "", person: "" })}>Clear</button>
            )}

            <span className="list-toolbar-add" style={{ display: "flex", gap: 10 }}>
              <ExportButtons label="this page" buttonText="Export page" onExport={exportParts} disabled={!shown.length} />
              <button className="btn btn-primary" onClick={() => { setAdding(a => !a); setError(""); }}>
                {adding ? "Cancel" : "ADD PARTS ENTRY"}
              </button>
            </span>
          </div>

          {notice && <p className="private-note-hint">{notice}</p>}
          {error && <p className="private-note-hint" style={{ color: "#dc2626" }}>⚠ {error}</p>}

          {adding && (
            <div className="admin-card" style={{ marginBottom: 20 }}>
              <h3 className="modal-title" style={{ marginTop: 0 }}>New parts entry</h3>
              {partForm(form, setForm, "new-part")}
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => { setAdding(false); setForm(blankPart()); setError(""); }}>Cancel</button>
                <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Add parts entry"}</button>
              </div>
            </div>
          )}

          <p className="analytics-card-sub" style={{ marginTop: 0 }}>
            {shown.length} {shown.length === 1 ? "entry" : "entries"}
            {partsTotal(shown) > 0 && <> · {formatMoney(partsTotal(shown))} total</>}
            {anyFilter && " (filtered)"}
          </p>

          {shown.length === 0 && (
            <p className="private-note-hint">{anyFilter ? "No parts match these filters." : "No parts entries yet. Use ADD PARTS ENTRY to start one."}</p>
          )}

          {shown.map(p => (
            editingId === p.id ? (
              <div key={p.id} className="admin-card" style={{ marginBottom: 12 }}>
                <h3 className="modal-title" style={{ marginTop: 0 }}>Edit parts entry</h3>
                {partForm(editForm, setEditForm, `edit-part-${p.id}`)}
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                  <button className="btn btn-primary" disabled={saving} onClick={saveEdit}>{saving ? "Saving…" : "Save"}</button>
                </div>
              </div>
            ) : (
              <div key={p.id} className="customer-card">
                <div className="customer-card-left">
                  <div className="customer-name">{p.item}</div>
                  <span className="role-badge" style={{ marginTop: 6 }}>{p.stage}</span>
                  {p.value && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {p.value}</div>}
                  {p.neededBy && <div className="customer-dates">Needed by {p.neededBy}</div>}
                </div>
                <div className="customer-card-middle">
                  <div className="private-note-hint">
                    {p.company}
                    {p.contact && <> · {p.contact}</>}
                  </div>
                  {(p.email || p.phone) && <div className="customer-meta">{[p.email, p.phone].filter(Boolean).join(" · ")}</div>}
                  {p.notes && <div className="customer-meta" style={{ marginTop: 4 }}>{p.notes}</div>}
                  <div className="notes-history-date" style={{ marginTop: 6 }}>
                    Entered by {nameOf(p.ownerId) || "someone"}
                    {p.updatedBy && p.updatedBy !== p.ownerId && <> · last edited by {nameOf(p.updatedBy)}</>}
                  </div>
                </div>
                <div className="customer-card-right">
                  <button className="btn btn-secondary btn-small" onClick={() => startEdit(p)}>Edit</button>
                  {/* Anyone can edit a parts entry; only whoever entered it
                      (or an admin) can delete one. */}
                  {(p.ownerId === uid || role === "admin") && (
                    <button className="btn btn-secondary btn-small" onClick={() => setConfirmDelete(p)}>Delete</button>
                  )}
                </div>
              </div>
            )
          ))}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this parts entry?"
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        >
          <p className="modal-subtitle">&quot;{confirmDelete.item}&quot; will be removed for everyone. This can&apos;t be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

// MobileNav reads the URL's query string, which Next wants wrapped.
export default function PartsPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading parts...</div>}>
      <PartsPageContent />
    </Suspense>
  );
}
