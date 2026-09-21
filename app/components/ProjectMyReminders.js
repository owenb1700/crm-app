"use client";

import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { localDateKey, weekdayKey } from "../../lib/closedProjects";

const fromKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// The signed-in user's own reminders attached to one project (from Add
// Reminder on the Home screen). Reminders are private, so nobody else ever
// sees this list.
export default function ProjectMyReminders({ projectId, uid }) {
  const [reminders, setReminders] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const snap = await getDocs(query(collection(db, "reminders"), where("userId", "==", uid)));
      setReminders(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(r => r.projectId === projectId)
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      );
      setLoadError("");
    } catch (err) {
      setLoadError(err.message || "Couldn't load your reminders.");
    }
  };

  useEffect(() => {
    if (uid && projectId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, projectId]);

  const followUp = async (r) => {
    const next = fromKey(r.date);
    next.setDate(next.getDate() + 7);
    const date = weekdayKey(next);
    try {
      await updateDoc(doc(db, "reminders", r.id), { date });
      setReminders(prev => prev.map(x => (x.id === r.id ? { ...x, date } : x)));
    } catch (err) {
      setError(`Couldn't move the reminder: ${err.message}`);
    }
  };

  const complete = async (r) => {
    if (!window.confirm(`Mark "${r.subject}" complete? It will be deleted permanently.`)) return;
    try {
      await deleteDoc(doc(db, "reminders", r.id));
      setReminders(prev => prev.filter(x => x.id !== r.id));
    } catch (err) {
      setError(`Couldn't complete the reminder: ${err.message}`);
    }
  };

  const today = localDateKey(new Date());

  return (
    <div className="project-section">
      <h4 className="field-label">My Reminders</h4>
      <p className="private-note-hint" style={{ marginBottom: 10 }}>
        Reminders you attached to this project with + Add Reminder. Only you see these.
      </p>

      {loadError && <p className="settings-status is-error">⚠ Couldn't load your reminders: {loadError}</p>}
      {!loadError && reminders.length === 0 && <p className="private-note-hint">No reminders attached to this project.</p>}

      {reminders.map(r => (
        <div key={r.id} className="notes-history-item">
          <div><strong>{r.subject}</strong></div>
          <div className="notes-history-date">
            Due {r.date}
            {r.date < today && <span className="calendar-overdue-tag">Overdue</span>}
          </div>
          {r.notes && <div className="notes-history-date" style={{ whiteSpace: "pre-wrap" }}>{r.notes}</div>}
          <div className="job-reminder-actions">
            <button className="btn btn-secondary" onClick={() => followUp(r)}>Follow Up (1 Week)</button>
            <button className="btn btn-primary" onClick={() => complete(r)}>Complete</button>
          </div>
        </div>
      ))}
      {error && <p className="settings-status is-error">{error}</p>}
    </div>
  );
}
