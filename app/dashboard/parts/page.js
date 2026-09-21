"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { withoutTrashed } from "../../../lib/trash";
import { COMPANY_CATEGORIES, ensureCompanyAndContactBatch } from "../../../lib/directory";
import { PART_STAGES, partFromProject, isPartsProject, blankPart, blankContractor, partPayload, partError, filterParts, sortParts, partsTotal, partChanges, logEntry, describeContractors } from "../../../lib/parts";
import { formatMoney } from "../../../lib/analytics";
import { personName } from "../../../lib/people";
import { downloadTable, csvDateStamp } from "../../../lib/csv";
import { FirmSelect, PersonSelect, peopleAtFirm, findPerson } from "../../components/DirectoryPickers";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNav from "../../components/MobileNav";
import ViewTabs from "../../components/ViewTabs";
import ExportButtons from "../../components/ExportButtons";
import MoneyInput from "../../components/MoneyInput";
import AddressAutocomplete from "../../components/AddressAutocomplete";
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
  // Projects still filed under the old "Parts" status, waiting to be moved.
  const [oldPartsProjects, setOldPartsProjects] = useState([]);
  const [moving, setMoving] = useState(false);

  const load = async () => {
    const [partsSnap, usersSnap, companiesSnap, contactsSnap, projectsSnap] = await Promise.all([
      getDocs(collection(db, "parts")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, "companies")),
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "customers"))
    ]);
    setParts(partsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setOldPartsProjects(
      withoutTrashed(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() }))).filter(isPartsProject)
    );
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
        updatedBy: uid,
        // Everything that happens to a parts entry is kept on it. No one
        // is emailed or alerted -- parts stay out of everyone's alerts.
        log: [logEntry({ kind: "created", by: uid, byName: nameOf(uid) })]
      });
      // A firm or person typed here joins the Directory, so parts work
      // builds the same contact list as everything else.
      await ensureCompanyAndContactBatch(
        [
          { companyName: payload.company, category: payload.companyCategory, contactName: payload.contact, email: payload.email, phone: payload.phone },
          ...payload.contractors.map(c => ({ companyName: c.company, category: "Contractor", contactName: c.contact }))
        ],
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
      const before = parts.find(x => x.id === editingId) || {};
      const payload = partPayload(editForm);
      const changes = partChanges(before, payload);
      await updateDoc(doc(db, "parts", editingId), {
        ...payload,
        updatedAt: new Date().toISOString(),
        updatedBy: uid,
        log: [...(before.log || []), logEntry({ kind: "updated", changes, by: uid, byName: nameOf(uid) })]
      });
      await ensureCompanyAndContactBatch(
        [
          { companyName: payload.company, category: payload.companyCategory, contactName: payload.contact, email: payload.email, phone: payload.phone },
          ...payload.contractors.map(c => ({ companyName: c.company, category: "Contractor", contactName: c.contact }))
        ],
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

  const moveOldPartsProjects = async () => {
    setMoving(true);
    setError("");
    try {
      const idToken = await auth.currentUser.getIdToken();
      for (const project of oldPartsProjects) {
        await addDoc(collection(db, "parts"), partFromProject(project, { by: uid, byName: nameOf(uid) }));
        const res = await fetch("/api/delete-record", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ kind: "project", id: project.id })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Couldn't retire "${project.projectName || project.company}"`);
        }
      }
      setNotice(`Moved ${oldPartsProjects.length} ${oldPartsProjects.length === 1 ? "project" : "projects"} into Parts. The originals are in the Trash for 30 days if anything looks wrong.`);
      await load();
    } catch (err) {
      setError(`${err.message}. Anything already moved stayed moved -- run it again to finish the rest.`);
    } finally {
      setMoving(false);
    }
  };

  const shown = useMemo(() => sortParts(filterParts(parts, filters)), [parts, filters]);
  const anyFilter = Object.values(filters).some(Boolean);

  const exportParts = (format) => downloadTable({
    format,
    filename: `parts${anyFilter ? "-filtered" : ""}-${csvDateStamp()}`,
    sheetName: "Parts",
    headers: ["Part", "Stage", "Firm type", "Firm", "Contact", "Email", "Phone", "Contractors", "Project address", "Value", "Needed by", "Notes", "Entered by", "Added", "Last updated by", "Changes logged"],
    rows: shown.map(p => [
      p.item, p.stage, p.companyCategory, p.company, p.contact, p.email, p.phone,
      describeContractors(p.contractors), p.projectAddress || "",
      p.value, p.neededBy, p.notes, nameOf(p.ownerId),
      String(p.createdAt || "").slice(0, 10), nameOf(p.updatedBy), (p.log || []).length
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

        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label" htmlFor={`${idPrefix}-address`}>Project address</label>
          <AddressAutocomplete
            id={`${idPrefix}-address`}
            name={`${idPrefix}-address`}
            placeholder="Where is this going?"
            value={values.projectAddress}
            onChange={v => setValues(prev => ({ ...prev, projectAddress: v }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor={`${idPrefix}-needed`}>Needed by</label>
          <input id={`${idPrefix}-needed`} className="field" type="date" value={values.neededBy} onChange={e => setValues(prev => ({ ...prev, neededBy: e.target.value }))} />
        </div>
      </div>

      <div style={{ marginTop: 6 }}>
        <label className="field-label">Contractors on this job (optional)</label>
        <p className="private-note-hint" style={{ marginTop: -4 }}>
          Whoever is doing the work, if that&apos;s not who the request came from. They&apos;re added to the Directory like any other firm.
        </p>
        {(values.contractors || []).map((row, i) => (
          <div key={i} className="form-grid-2" style={{ alignItems: "end", marginBottom: 6 }}>
            <div>
              <label className="field-label" htmlFor={`${idPrefix}-contractor-${i}`}>Contractor</label>
              <FirmSelect
                id={`${idPrefix}-contractor-${i}`}
                companies={companies}
                category="Contractor"
                value={row.company}
                onChange={v => setValues(prev => ({
                  ...prev,
                  contractors: (prev.contractors || []).map((r, x) => (x === i ? { ...r, company: v } : r))
                }))}
              />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <div style={{ flex: 1 }}>
                <label className="field-label" htmlFor={`${idPrefix}-contractor-contact-${i}`}>Their contact</label>
                <PersonSelect
                  id={`${idPrefix}-contractor-contact-${i}`}
                  people={peopleAtFirm(contacts, row.company, companies)}
                  value={row.contact}
                  onChange={v => setValues(prev => ({
                    ...prev,
                    contractors: (prev.contractors || []).map((r, x) => (x === i ? { ...r, contact: v } : r))
                  }))}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setValues(prev => ({ ...prev, contractors: (prev.contractors || []).filter((_, x) => x !== i) }))}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setValues(prev => ({ ...prev, contractors: [...(prev.contractors || []), blankContractor()] }))}
        >
          + Add contractor
        </button>
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

          {oldPartsProjects.length > 0 && (
            <div className="duplicate-warning" style={{ marginBottom: 16 }}>
              <strong>{oldPartsProjects.length} project{oldPartsProjects.length === 1 ? " is" : "s are"} still filed as Parts in My Projects.</strong>
              <div className="private-note-hint" style={{ marginTop: 4 }}>
                Moving them makes a parts entry for each — firm, contact, value, address and all — and puts the original project in the Trash, where it can be revived for 30 days.
              </div>
              <div className="duplicate-warning-actions">
                <button className="btn btn-primary" disabled={moving} onClick={moveOldPartsProjects}>
                  {moving ? "Moving…" : `Move ${oldPartsProjects.length === 1 ? "it" : "them"} into Parts`}
                </button>
              </div>
            </div>
          )}

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
                  {p.projectAddress && <div className="customer-meta" style={{ marginTop: 4 }}>{p.projectAddress}</div>}
                  {describeContractors(p.contractors) && (
                    <div className="customer-meta" style={{ marginTop: 4 }}>Contractors: {describeContractors(p.contractors)}</div>
                  )}
                  {p.notes && <div className="customer-meta" style={{ marginTop: 4 }}>{p.notes}</div>}
                  {(p.log || []).length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary className="notes-history-date" style={{ cursor: "pointer" }}>
                        History ({p.log.length})
                      </summary>
                      {[...p.log].reverse().map((entry, i) => (
                        <div key={`${entry.at}-${i}`} className="notes-history-date" style={{ marginTop: 4 }}>
                          {String(entry.at).slice(0, 10)} · {entry.byName || nameOf(entry.by) || "someone"}
                          {entry.kind === "created" && " created this entry"}
                          {entry.kind === "updated" && (entry.changes?.length
                            ? <> changed {entry.changes.join("; ")}</>
                            : " saved it with no changes")}
                        </div>
                      ))}
                    </details>
                  )}
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
