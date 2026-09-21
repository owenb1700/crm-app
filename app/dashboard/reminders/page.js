"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { localDateKey, weekdayKey } from "../../../lib/closedProjects";
import { withoutTrashed } from "../../../lib/trash";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNav from "../../components/MobileNav";
import JobPicker from "../../components/JobPicker";
import ConfirmDialog from "../../components/ConfirmDialog";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;

const fromKey = (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, m - 1, d);
};

const blankForm = () => ({ subject: "", date: localDateKey(new Date()), notes: "", job: "" });

// Every reminder of yours in one place: add, edit, follow up, or complete.
// Reminders are private -- this only ever shows the signed-in user's own.
export default function RemindersPage() {
  const router = useRouter();
  const [uid, setUid] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [reminders, setReminders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [pipelineEntries, setPipelineEntries] = useState([]);
  const [role, setRole] = useState(null);

  const [form, setForm] = useState(blankForm());
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async (currentUid) => {
    const [remindersSnap, customersSnap, pipelineSnap] = await Promise.all([
      getDocs(query(collection(db, "reminders"), where("userId", "==", currentUid))),
      getDocs(collection(db, "customers")),
      getDocs(collection(db, "pipeline"))
    ]);
    setReminders(remindersSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.date).localeCompare(String(b.date))));
    setCustomers(withoutTrashed(customersSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
    setPipelineEntries(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
    setLoaded(true);
  };

  useEffect(() => {
    let timer;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const loginTimestamp = Number(localStorage.getItem("loginTimestamp") || 0);
      const elapsed = Date.now() - loginTimestamp;
      if (!user || !loginTimestamp || elapsed > SESSION_LENGTH_MS) {
        localStorage.removeItem("loginTimestamp");
        signOut(auth);
        router.push("/");
        return;
      }
      timer = setTimeout(() => {
        localStorage.removeItem("loginTimestamp");
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
          localStorage.removeItem("loginTimestamp");
          await signOut(auth);
          router.push("/");
          return;
        }
        setRole(profileSnap.data().role || "member");
        await load(user.uid);
      } catch (err) {
        setLoadError(err.message || "Couldn't load your reminders.");
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jobs a reminder can be attached to: active projects you own or
  // collaborate on (all of them for admins) and open pipeline entries.
  const jobOptions = [
    ...customers
      .filter(c => c.category !== "Project Closed")
      .filter(c => role === "admin" || c.ownerId === uid || (c.collaboratorIds || []).includes(uid))
      .map(c => ({
        key: `project:${c.id}`, kind: "project", id: c.id,
        label: c.projectName || c.company || "Untitled project",
        sub: [c.projectName && c.company !== c.projectName ? c.company : "", c.projectAddress].filter(Boolean).join(" · ")
      })),
    ...pipelineEntries
      .filter(p => !p.outcome && !p.convertedToProjectId)
      .map(p => ({
        key: `pipeline:${p.id}`, kind: "pipeline", id: p.id,
        label: p.title || "Untitled pipeline entry",
        sub: [p.stage, p.bidDate && `Bid ${p.bidDate}`, p.company].filter(Boolean).join(" · ")
      }))
  ].sort((a, b) => a.label.localeCompare(b.label));

  const jobKeyOf = (r) => (r.projectId ? `project:${r.projectId}` : r.pipelineId ? `pipeline:${r.pipelineId}` : "");
  const jobOf = (r) => {
    if (r.projectId) {
      const c = customers.find(x => x.id === r.projectId);
      return c ? { name: c.projectName || c.company || "a project", href: `/dashboard/project/${c.id}` } : null;
    }
    if (r.pipelineId) {
      const p = pipelineEntries.find(x => x.id === r.pipelineId);
      return p ? { name: p.title || "a pipeline entry", href: `/dashboard/pipeline/${p.id}` } : null;
    }
    return null;
  };

  const jobFields = (jobKey) => {
    const [kind, id] = (jobKey || "").split(":");
    return { projectId: kind === "project" ? id : null, pipelineId: kind === "pipeline" ? id : null };
  };

  const addReminder = async () => {
    const subject = form.subject.trim();
    if (!subject) return setError("Enter a subject for this reminder");
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "reminders"), {
        userId: uid,
        subject,
        date: form.date,
        notes: form.notes.trim() || null,
        ...jobFields(form.job),
        createdAt: new Date().toISOString()
      });
      setForm(blankForm());
      setNotice("Reminder added");
      await load(uid);
    } catch (err) {
      setError(`Couldn't add this reminder: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (r) => {
    setEditingId(r.id);
    setEditForm({ subject: r.subject || "", date: r.date || localDateKey(new Date()), notes: r.notes || "", job: jobKeyOf(r) });
  };

  const saveEdit = async () => {
    const subject = editForm.subject.trim();
    if (!subject) return setError("Enter a subject for this reminder");
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "reminders", editingId), {
        subject,
        date: editForm.date,
        notes: editForm.notes.trim() || null,
        ...jobFields(editForm.job)
      });
      setEditingId(null);
      setNotice("Reminder updated");
      await load(uid);
    } catch (err) {
      setError(`Couldn't save this reminder: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const followUp = async (r) => {
    const next = fromKey(r.date);
    next.setDate(next.getDate() + 7);
    const date = weekdayKey(next);
    try {
      await updateDoc(doc(db, "reminders", r.id), { date });
      setReminders(prev => [...prev.map(x => (x.id === r.id ? { ...x, date } : x))].sort((a, b) => String(a.date).localeCompare(String(b.date))));
      setNotice(`Moved to ${date}`);
    } catch (err) {
      setError(`Couldn't move this reminder: ${err.message}`);
    }
  };

  const complete = async (r) => {
    try {
      await deleteDoc(doc(db, "reminders", r.id));
      setReminders(prev => prev.filter(x => x.id !== r.id));
      setConfirmComplete(null);
      setNotice("Reminder completed");
    } catch (err) {
      setError(`Couldn't complete this reminder: ${err.message}`);
    }
  };

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn&apos;t load your reminders</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="dashboard-page">Loading...</div>;

  const today = localDateKey(new Date());
  const overdue = reminders.filter(r => String(r.date) < today);
  const upcoming = reminders.filter(r => String(r.date) >= today);

  const renderReminder = (r) => {
    const job = jobOf(r);
    if (editingId === r.id) {
      return (
        <div key={r.id} className="reminder-row is-editing">
          <div className="form-grid-2">
            <div>
              <label className="field-label" htmlFor={`edit-subject-${r.id}`}>Subject</label>
              <input id={`edit-subject-${r.id}`} className="field" autoComplete="off" value={editForm.subject} onChange={e => setEditForm({ ...editForm, subject: e.target.value })} />
            </div>
            <div>
              <label className="field-label" htmlFor={`edit-date-${r.id}`}>Date</label>
              <input id={`edit-date-${r.id}`} className="field" type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} />
            </div>
          </div>
          <label className="field-label" htmlFor={`edit-job-${r.id}`}>Attached to a job (optional)</label>
          <JobPicker id={`edit-job-${r.id}`} options={jobOptions} value={editForm.job} onChange={v => setEditForm({ ...editForm, job: v })} />
          <label className="field-label" htmlFor={`edit-notes-${r.id}`}>Notes (optional)</label>
          <textarea id={`edit-notes-${r.id}`} className="field" style={{ width: "100%", height: 70 }} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
          <div className="reminder-row-actions">
            <button className="btn btn-primary" disabled={saving} onClick={saveEdit}>{saving ? "Saving…" : "Save"}</button>
            <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      );
    }
    return (
      <div key={r.id} className="reminder-row">
        <div className="reminder-row-main">
          <div className="reminder-row-title">
            <strong>{r.subject}</strong>
            {String(r.date) < today && <span className="calendar-overdue-tag">Overdue</span>}
          </div>
          <div className="notes-history-date">
            Due {r.date}
            {job && <> · for <a className="link-muted" href={job.href}>{job.name}</a></>}
          </div>
          {r.notes && <div className="reminder-row-notes">{r.notes}</div>}
        </div>
        <div className="reminder-row-actions">
          <button className="btn btn-secondary" onClick={() => followUp(r)}>Follow Up (2 Weeks)</button>
          <button className="btn btn-secondary" onClick={() => startEdit(r)}>Edit</button>
          <button className="btn btn-primary" onClick={() => setConfirmComplete(r)}>Complete</button>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">My Reminders</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>← Back to My Projects</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <div className="project-page">
        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Add a reminder</h4>
          <p className="private-note-hint">Only you can see your reminders. They show on your calendar, My Projects, and digest emails.</p>
          <div className="form-grid-2">
            <div>
              <label className="field-label" htmlFor="new-subject">Subject</label>
              <input id="new-subject" className="field" autoComplete="off" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div>
              <label className="field-label" htmlFor="new-date">Date</label>
              <input id="new-date" className="field" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <label className="field-label" htmlFor="new-job">Attach to a job (optional)</label>
          <JobPicker id="new-job" options={jobOptions} value={form.job} onChange={v => setForm({ ...form, job: v })} />
          <label className="field-label" htmlFor="new-notes">Notes (optional)</label>
          <textarea id="new-notes" className="field" style={{ width: "100%", height: 70 }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <div className="reminder-row-actions">
            <button className="btn btn-primary" disabled={saving} onClick={addReminder}>{saving ? "Adding…" : "Add Reminder"}</button>
          </div>
          {error && <p className="settings-status is-error">{error}</p>}
          {notice && !error && <p className="settings-status is-ok">{notice}</p>}
        </div>

        {overdue.length > 0 && (
          <div className="project-section">
            <h4 className="field-label" style={{ marginTop: 0 }}>Overdue ({overdue.length})</h4>
            {overdue.map(renderReminder)}
          </div>
        )}

        <div className="project-section">
          <h4 className="field-label" style={{ marginTop: 0 }}>Upcoming ({upcoming.length})</h4>
          {upcoming.length === 0 && <p className="private-note-hint">Nothing coming up.</p>}
          {upcoming.map(renderReminder)}
        </div>
      </div>

      {confirmComplete && (
        <ConfirmDialog
          title={`Complete "${confirmComplete.subject}"?`}
          confirmLabel="Complete"
          danger
          onCancel={() => setConfirmComplete(null)}
          onConfirm={() => complete(confirmComplete)}
        >
          <p>Completing a reminder deletes it for good. Use Follow Up (2 Weeks) instead to push it out.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
