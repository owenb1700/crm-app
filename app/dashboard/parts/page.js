"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { withoutTrashed } from "../../../lib/trash";
import { COMPANY_CATEGORIES, ensureCompanyAndContactBatch } from "../../../lib/directory";
import { partFromProject, isPartsProject, blankPart, partPayload, partError, filterParts, partsTotal, logEntry, describeContractors, PART_STAGES, firmTypeLine } from "../../../lib/parts";
import { formatMoney, withDollar } from "../../../lib/analytics";
import { personName } from "../../../lib/people";
import { downloadTable, csvDateStamp } from "../../../lib/csv";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNav from "../../components/MobileNav";
import ViewTabs from "../../components/ViewTabs";
import ExportButtons from "../../components/ExportButtons";
import ConfirmDialog from "../../components/ConfirmDialog";
import PartForm from "../../components/PartForm";
import NotesModal from "../../components/NotesModal";
import useUnsavedGuard from "../../components/useUnsavedGuard";
import SortPicker from "../../components/SortPicker";
import { sortRows } from "../../../lib/sorting";
import FirmDetailsPrompt from "../../components/FirmDetailsPrompt";
import { saveFirmTags } from "../../../lib/firmTypes";
import { firmsNeedingDetails } from "../../../lib/newFirms";

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
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Notes read and written straight from the list, same thread as the
  // request's own page.
  const [notesFor, setNotesFor] = useState(null);
  // The firm we're waiting on a contractor type for, if any.
  const [firmQueue, setFirmQueue] = useState(null);
  const [sort, setSort] = useState({ key: "needed", direction: "asc" });
  // Anything typed into the add box is worth warning about.
  useUnsavedGuard(adding && Object.values(form).some(v => (Array.isArray(v) ? v.length : String(v || "").trim()) && v !== "Quoted" && v !== "Contractor"));
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
    setParts(withoutTrashed(partsSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
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

  const save = async (choice = null) => {
    // Only the prompt's answer counts -- a click event is not one.
    const contractorType = choice && !choice.nativeEvent && typeof choice === "object" ? choice : null;
    const message = partError(form);
    if (message) return setError(message);
    const payloadPreview = partPayload(form);
    const needDetails = contractorType ? [] : firmsNeedingDetails([
      { name: payloadPreview.company, category: payloadPreview.companyCategory },
      ...payloadPreview.contractors.map(c => ({ name: c.company, category: "Contractor" }))
    ], companies);
    if (needDetails.length) return setFirmQueue(needDetails);
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
      if (contractorType) {
        await Promise.all(Object.entries(contractorType).map(([name, tags]) => {
          const category = name === payload.company ? payload.companyCategory : "Contractor";
          return saveFirmTags(name, category, tags);
        }));
      }
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

  const remove = async (p) => {
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/delete-record", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ kind: "part", id: p.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't delete this parts entry");
      setParts(prev => prev.filter(x => x.id !== p.id));
      setConfirmDelete(null);
      setNotice("Moved to the Trash — it can be brought back for 30 days");
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

  const PART_SORTS = {
    needed: { kind: "date", get: p => p.neededBy, label: "Needed by" },
    item: { kind: "text", get: p => p.item, label: "Part" },
    firm: { kind: "text", get: p => p.company, label: "Firm" },
    value: { kind: "money", get: p => p.value, label: "Value" },
    stage: { kind: "text", get: p => p.stage, label: "Stage" },
    added: { kind: "date", get: p => p.createdAt, label: "Date added" }
  };

  const shown = useMemo(
    () => sortRows(filterParts(parts, filters), PART_SORTS, sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parts, filters, sort]
  );
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

            <SortPicker id="parts-sort" options={PART_SORTS} sort={sort} onChange={setSort} />
            <span className="list-toolbar-add" style={{ display: "flex", gap: 10 }}>
              <ExportButtons label="this page" buttonText="Export page" onExport={exportParts} disabled={!shown.length} />
              <button className="btn btn-primary" onClick={() => { setAdding(a => !a); setError(""); }}>
                {adding ? "Cancel" : "ADD PARTS ENTRY"}
              </button>
            </span>
          </div>

          {role === "admin" && oldPartsProjects.length > 0 && (
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
              <PartForm values={form} setValues={setForm} idPrefix="new-part" companies={companies} contacts={contacts} />
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => { setAdding(false); setForm(blankPart()); setError(""); }}>Cancel</button>
                <button className="btn btn-primary" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Add parts entry"}</button>
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
            <div
              key={p.id}
              className="customer-card"
              style={{ cursor: "pointer" }}
              onClick={() => router.push(`/dashboard/parts/${p.id}`)}
            >
              <div className="customer-card-left">
                <div className="customer-name">{p.item}</div>
                <span className="role-badge" style={{ marginTop: 6 }}>{p.stage}</span>
                {p.value && <div className="customer-meta" style={{ marginTop: 4 }}>Value: {withDollar(p.value)}</div>}
                {p.neededBy && <div className="customer-dates">Needed by {p.neededBy}</div>}
              </div>
              <div className="customer-card-middle">
                <div className="private-note-hint">
                  {p.company}
                  {p.contact && <> · {p.contact}</>}
                </div>
                <div className="customer-meta">{firmTypeLine(p, companies)}</div>
                {p.projectAddress && <div className="customer-meta" style={{ marginTop: 4 }}>{p.projectAddress}</div>}
                {describeContractors(p.contractors) && (
                  <div className="customer-meta" style={{ marginTop: 4 }}>Contractors: {describeContractors(p.contractors)}</div>
                )}
                <div
                  className="customer-notes-preview"
                  style={{ marginTop: 6 }}
                  onClick={(e) => { e.stopPropagation(); setNotesFor(p); }}
                  title="Notes"
                >
                  {p.notes || <span className="private-note-hint">Add a note…</span>}
                </div>
                <div className="notes-history-date" style={{ marginTop: 6 }}>
                  Entered by {nameOf(p.ownerId) || "someone"}
                  {(p.log || []).length > 0 && <> · {p.log.length} change{p.log.length === 1 ? "" : "s"} logged</>}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {firmQueue && (
        <FirmDetailsPrompt
          queue={firmQueue}
          busy={saving}
          onDone={(tags) => { setFirmQueue(null); save(tags); }}
          onCancel={() => setFirmQueue(null)}
        />
      )}

      {notesFor && uid && (
        <NotesModal
          title={notesFor.item}
          subtitle={[notesFor.company, notesFor.stage].filter(Boolean).join(" · ")}
          collectionName="parts"
          recordId={notesFor.id}
          uid={uid}
          myName={nameOf(uid)}
          onClose={() => setNotesFor(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this parts entry?"
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        >
          <p className="modal-subtitle">
            &quot;{confirmDelete.item}&quot; goes to the Trash, where you or an admin can bring it back for 30 days.
          </p>
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
