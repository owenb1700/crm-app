"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { auth, db } from "../../../../../lib/firebase";
import { withoutTrashed } from "../../../../../lib/trash";
import { historyForPerson, countsByKind } from "../../../../../lib/personHistory";
import { personName } from "../../../../../lib/people";
import DashboardHeader from "../../../../components/DashboardHeader";
import MobileNav from "../../../../components/MobileNav";
import ConfirmDialog from "../../../../components/ConfirmDialog";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const clearSession = () => localStorage.removeItem("loginTimestamp");

const valuesOf = (record, plural, single) => {
  const list = Array.isArray(record?.[plural]) ? record[plural].filter(Boolean) : [];
  if (list.length) return list;
  return record?.[single] ? [record[single]] : [];
};

// One person at one firm: how to reach them, what's been written about
// them, and every project, pipeline entry and parts order they've been
// named on.
function PersonPageContent() {
  const params = useParams();
  const router = useRouter();
  const contactId = params.id;

  const [uid, setUid] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [person, setPerson] = useState(null);
  const [company, setCompany] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [parts, setParts] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [personNotes, setPersonNotes] = useState([]);
  const [confirmingNote, setConfirmingNote] = useState(null);

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

        const personSnap = await getDoc(doc(db, "contacts", contactId));
        if (!personSnap.exists()) {
          setNotFound(true);
          setLoaded(true);
          return;
        }
        const record = { id: personSnap.id, ...personSnap.data() };
        setPerson(record);

        const notesSnap = await getDocs(collection(db, "contacts", contactId, "notes"));
        setPersonNotes(
          notesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
        );

        const [companySnap, projectsSnap, pipelineSnap, partsSnap, usersSnap] = await Promise.all([
          record.companyId ? getDoc(doc(db, "companies", record.companyId)) : Promise.resolve(null),
          getDocs(collection(db, "customers")),
          getDocs(collection(db, "pipeline")),
          getDocs(collection(db, "parts")),
          getDocs(collection(db, "users"))
        ]);
        if (companySnap?.exists()) setCompany({ id: companySnap.id, ...companySnap.data() });
        setProjects(withoutTrashed(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setPipeline(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setParts(partsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading this person.");
        setLoaded(true);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const firmName = company?.name || person?.companyName || "";

  const history = useMemo(
    () => (person ? historyForPerson({ person: person.name, firmName, projects, pipeline, parts }) : []),
    [person, firmName, projects, pipeline, parts]
  );
  const counts = countsByKind(history);

  const nameOf = (id) => (id ? personName(users.find(u => u.id === id)) : "someone");

  const addNote = async () => {
    const text = noteDraft.trim();
    if (!text) return;
    setSavingNote(true);
    try {
      const entry = { text, by: uid, byName: nameOf(uid), at: new Date().toISOString() };
      const ref = await addDoc(collection(db, "contacts", contactId, "notes"), entry);
      setPersonNotes(prev => [...prev, { id: ref.id, ...entry }]);
      // Kept on the contact too, so the Directory list still shows the
      // latest note at a glance.
      await updateDoc(doc(db, "contacts", contactId), { notes: text }).catch(() => {});
      setNoteDraft("");
    } catch (err) {
      setLoadError(`Couldn't save that note: ${err.message}`);
    } finally {
      setSavingNote(false);
    }
  };

  // Your own notes only -- the rule checks the author, so this is not the
  // only thing standing between someone and a teammate's note.
  const deleteNote = async () => {
    setSavingNote(true);
    try {
      await deleteDoc(doc(db, "contacts", contactId, "notes", confirmingNote.id));
      setPersonNotes(prev => prev.filter(n => n.id !== confirmingNote.id));
      setConfirmingNote(null);
    } catch (err) {
      setLoadError(`Couldn't delete that note: ${err.message}`);
    } finally {
      setSavingNote(false);
    }
  };

  if (loadError && !person) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load this person</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>Back to Directory</button>
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Person not found</h3>
          <p className="modal-subtitle">They may have been deleted or merged into someone else.</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard/directory")}>Back to Directory</button>
        </div>
      </div>
    );
  }
  if (!loaded || !person) return <div className="dashboard-page">Loading...</div>;

  const emails = valuesOf(person, "emails", "email");
  const phones = valuesOf(person, "phones", "phone");
  const notes = [...personNotes].reverse();

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} profile={myProfile} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">{person.name}</h1>
        </div>
        <div className="dashboard-header-actions">
          {company && (
            <button className="btn btn-secondary" onClick={() => router.push(`/dashboard/directory/company/${company.id}`)}>
              ← Back to {company.name}
            </button>
          )}
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <h4 className="field-label">Details</h4>
          <p><strong>Firm:</strong> {firmName || "—"}</p>
          <p><strong>Title:</strong> {person.title || "—"}</p>
          <p><strong>Email:</strong> {emails.length ? emails.join(", ") : "—"}</p>
          <p><strong>Phone:</strong> {phones.join(", ") || "—"}</p>
          <p className="private-note-hint">
            {history.length
              ? `${history.length} ${history.length === 1 ? "job" : "jobs"} on file — ${counts.Project || 0} project${(counts.Project || 0) === 1 ? "" : "s"}, ${counts.Pipeline || 0} pipeline, ${counts.Parts || 0} parts.`
              : "Nothing on file with them yet."}
          </p>
        </div>

        <div className="project-section">
          <h4 className="field-label">Notes about {person.name.split(" ")[0]}</h4>
          <textarea
            className="field"
            style={{ width: "100%", height: 70 }}
            placeholder="What's worth remembering about working with them?"
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
          />
          <button className="btn btn-primary" disabled={savingNote || !noteDraft.trim()} onClick={addNote}>
            {savingNote ? "Saving…" : "Add note"}
          </button>

          {notes.length === 0 && !person.notes && (
            <p className="private-note-hint" style={{ marginTop: 10 }}>No notes yet.</p>
          )}
          {/* Notes written before the log existed have no author or date. */}
          {notes.length === 0 && person.notes && (
            <div className="notes-history-item" style={{ marginTop: 10 }}>
              <div style={{ whiteSpace: "pre-wrap" }}>{person.notes}</div>
            </div>
          )}
          {notes.map((n, i) => (
            <div key={n.id || `${n.at}-${i}`} className="notes-history-item notes-history-row" style={{ marginTop: 10 }}>
              <div>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
                <div className="notes-history-date">
                  {n.byName || nameOf(n.by)} · {String(n.at || "").slice(0, 10)}
                </div>
              </div>
              {n.by === uid && (
                <button className="btn btn-secondary" onClick={() => setConfirmingNote(n)}>Delete</button>
              )}
            </div>
          ))}
        </div>

        {confirmingNote && (
          <ConfirmDialog
            title="Delete this note?"
            confirmLabel="Delete"
            danger
            busy={savingNote}
            onConfirm={deleteNote}
            onCancel={() => setConfirmingNote(null)}
          >
            <p className="modal-subtitle">It&apos;s gone for good — no copy is kept.</p>
          </ConfirmDialog>
        )}

        <div className="project-section detail-span-full">
          <h4 className="field-label">Work with {person.name}</h4>
          {history.length === 0 ? (
            <p className="private-note-hint">
              Nothing yet. Projects, pipeline entries and parts orders naming them at {firmName || "this firm"} show up here.
            </p>
          ) : (
            <div className="analytics-table-wrap">
            <table className="analytics-table stack-on-phone">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Type</th>
                  <th>Their role</th>
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
                    <td data-label="Status">{row.status || "—"}</td>
                    <td data-label="Value">{row.value || "—"}</td>
                    <td data-label="Date">{row.date || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PersonPage() {
  return (
    <Suspense fallback={<div className="dashboard-page">Loading...</div>}>
      <PersonPageContent />
    </Suspense>
  );
}
