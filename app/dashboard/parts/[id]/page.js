"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { auth, db } from "../../../../lib/firebase";
import { ensureCompanyAndContactBatch } from "../../../../lib/directory";
import { blankPart, partPayload, partError, partChanges, logEntry, describeContractors, firmTypeLine } from "../../../../lib/parts";
import { withDollar } from "../../../../lib/analytics";
import { personName } from "../../../../lib/people";
import DashboardHeader from "../../../components/DashboardHeader";
import MobileNav from "../../../components/MobileNav";
import PartForm from "../../../components/PartForm";
import RecordNotes from "../../../components/RecordNotes";
import ConfirmDialog from "../../../components/ConfirmDialog";
import useUnsavedGuard from "../../../components/useUnsavedGuard";
import FirmDetailsPrompt from "../../../components/FirmDetailsPrompt";
import { saveFirmTags } from "../../../../lib/firmTypes";
import { firmsNeedingDetails } from "../../../../lib/newFirms";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const clearSession = () => localStorage.removeItem("loginTimestamp");

// One parts request, on its own page like a project or a pipeline entry:
// the details, its notes, and the history of every change made to it.
// Anyone can edit; only whoever entered it (or an admin) can delete it.
function PartPageContent() {
  const params = useParams();
  const router = useRouter();
  const partId = params.id;

  const [uid, setUid] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [role, setRole] = useState(null);
  const [part, setPart] = useState(null);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  // Closing the tab mid-edit shouldn't lose what's typed.
  useUnsavedGuard(isEditing);
  const [editForm, setEditForm] = useState(blankPart());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [firmQueue, setFirmQueue] = useState(null);

  const load = async () => {
    const snap = await getDoc(doc(db, "parts", partId));
    if (!snap.exists()) {
      setNotFound(true);
      setLoaded(true);
      return;
    }
    setPart({ id: snap.id, ...snap.data() });
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

        const [usersSnap, companiesSnap, contactsSnap] = await Promise.all([
          getDocs(collection(db, "users")),
          getDocs(collection(db, "companies")),
          getDocs(collection(db, "contacts"))
        ]);
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        await load();
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this parts request.");
        setLoaded(true);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId]);

  const nameOf = (id) => (id ? personName(users.find(u => u.id === id)) : "");
  const myName = () => (myProfile ? `${myProfile.firstName} ${myProfile.lastName}` : (auth.currentUser?.email || "Unknown"));

  const startEdit = () => {
    setEditForm({ ...blankPart(), ...part });
    setIsEditing(true);
    setError("");
  };

  const save = async (choice = null) => {
    // Called straight from a button, React would hand us the click event;
    // only a real answer from the prompt counts.
    const firmTags = choice && !choice.nativeEvent && typeof choice === "object" ? choice : null;
    const message = partError(editForm);
    if (message) return setError(message);
    const payloadPreview = partPayload(editForm);
    const needDetails = firmTags ? [] : firmsNeedingDetails([
      { name: payloadPreview.company, category: payloadPreview.companyCategory },
      ...payloadPreview.contractors.map(c => ({ name: c.company, category: "Contractor" }))
    ], companies);
    if (needDetails.length) return setFirmQueue(needDetails);
    setSaving(true);
    setError("");
    try {
      const payload = partPayload(editForm);
      const changes = partChanges(part, payload);
      await updateDoc(doc(db, "parts", partId), {
        ...payload,
        updatedAt: new Date().toISOString(),
        updatedBy: uid,
        log: [...(part.log || []), logEntry({ kind: "updated", changes, by: uid, byName: myName() })]
      });
      await ensureCompanyAndContactBatch(
        [
          { companyName: payload.company, category: payload.companyCategory, contactName: payload.contact, email: payload.email, phone: payload.phone },
          ...payload.contractors.map(c => ({ companyName: c.company, category: "Contractor", contactName: c.contact }))
        ],
        { companies, contacts, uid }
      );
      if (firmTags) {
        await Promise.all(Object.entries(firmTags).map(([name, tags]) => {
          const category = name === payload.company ? payload.companyCategory : "Contractor";
          return saveFirmTags(name, category, tags);
        }));
        // Read the firms back, so what was just answered is known here
        // rather than being asked again on the next save.
        const companiesSnap = await getDocs(collection(db, "companies"));
        setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
      setIsEditing(false);
      setFirmQueue(null);
      await load();
    } catch (err) {
      setError(`Couldn't save this parts request: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await deleteDoc(doc(db, "parts", partId));
      router.push("/dashboard/parts");
    } catch (err) {
      setError(`Couldn't delete this parts request: ${err.message}`);
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load this parts request</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/parts")}>Back to Parts</button>
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Parts request not found</h3>
          <p className="modal-subtitle">It may have been deleted.</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/parts")}>Back to Parts</button>
        </div>
      </div>
    );
  }
  if (!loaded || !part) return <div className="dashboard-page">Loading...</div>;

  const canDelete = part.ownerId === uid || role === "admin";
  const history = [...(part.log || [])].reverse();

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} profile={myProfile ? { ...myProfile, role } : null} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <div>
            <h1 className="dashboard-title">{part.item}</h1>
            {part.projectAddress && <p className="private-note-hint" style={{ margin: 0 }}>{part.projectAddress}</p>}
          </div>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/parts")}>← Back to Parts</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <div className="project-section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <h4 className="field-label" style={{ margin: 0 }}>Details</h4>
            {!isEditing && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-small" onClick={startEdit}>Edit</button>
                {canDelete && <button className="btn btn-secondary btn-small" onClick={() => setConfirmDelete(true)}>Delete</button>}
              </div>
            )}
          </div>

          {error && <p className="settings-status is-error">{error}</p>}

          {isEditing ? (
            <>
              <PartForm values={editForm} setValues={setEditForm} idPrefix={`part-${partId}`} companies={companies} contacts={contacts} />
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving} onClick={() => save()}>{saving ? "Saving…" : "Save"}</button>
              </div>
            </>
          ) : (
            <dl className="detail-list">
              <dt>Stage</dt><dd>{part.stage || "—"}</dd>
              <dt>Value</dt><dd>{withDollar(part.value) || "—"}</dd>
              <dt>{part.companyCategory || "Firm"}</dt><dd>{part.company || "—"}</dd>
              <dt>Firm type</dt><dd>{firmTypeLine(part, companies) || "—"}</dd>
              <dt>Contact</dt><dd>{part.contact || "—"}</dd>
              <dt>Email</dt><dd>{part.email || "—"}</dd>
              <dt>Phone</dt><dd>{part.phone || "—"}</dd>
              <dt>Contractors</dt><dd>{describeContractors(part.contractors) || "—"}</dd>
              <dt>Project address</dt><dd>{part.projectAddress || "—"}</dd>
              <dt>Needed by</dt><dd>{part.neededBy || "—"}</dd>
              <dt>Entered by</dt><dd>{nameOf(part.ownerId) || "—"}</dd>
            </dl>
          )}

          {!isEditing && part.notes && (
            <p className="private-note-hint" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{part.notes}</p>
          )}
        </div>

        <div className="project-section">
          <h4 className="field-label">Notes</h4>
          <p className="private-note-hint">Everyone can read and add. You can delete your own.</p>
          {uid && (
            <RecordNotes
              collectionName="parts"
              recordId={partId}
              uid={uid}
              myName={myName()}
              canAdd
            />
          )}
        </div>

        <div className="project-section detail-span-full">
          <h4 className="field-label">History ({history.length})</h4>
          {history.length === 0 ? (
            <p className="private-note-hint">Nothing recorded yet.</p>
          ) : (
            history.map((entry, i) => (
              <div key={`${entry.at}-${i}`} className="notes-history-item">
                <div>
                  {entry.kind === "created" && "Created this request"}
                  {entry.kind === "updated" && (entry.changes?.length ? entry.changes.join("; ") : "Saved with no changes")}
                </div>
                <div className="notes-history-date">
                  {entry.byName || nameOf(entry.by) || "someone"} · {String(entry.at || "").slice(0, 10)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {firmQueue && (
        <FirmDetailsPrompt
          queue={firmQueue}
          busy={saving}
          onDone={(tags) => { setFirmQueue(null); save(tags); }}
          onCancel={() => setFirmQueue(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this parts request?"
          confirmLabel="Delete"
          danger
          busy={saving}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        >
          <p className="modal-subtitle">&quot;{part.item}&quot; will be removed for everyone. This can&apos;t be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

export default function PartPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading...</div>}>
      <PartPageContent />
    </Suspense>
  );
}
