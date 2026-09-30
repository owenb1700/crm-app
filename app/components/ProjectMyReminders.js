"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { localDateKey, weekdayKey } from "../../lib/closedProjects";
import ConfirmDialog from "./ConfirmDialog";
import { completedPayload, openOnly, doneOnly, describeDone } from "../../lib/reminders";
import Icon from "./Icon";

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
  const [ask, setAsk] = useState(null);

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

  const complete = (r) => setAsk({
    subject: r.subject,
    onConfirm: () => reallyComplete(r)
  });

  const reallyComplete = async (r) => {
    setAsk(null);
    setError("");
    try {
      await updateDoc(doc(db, "reminders", r.id), completedPayload(uid));
      setReminders(prev => prev.map(x => (x.id === r.id ? { ...x, ...completedPayload(uid) } : x)));
    } catch (err) {
      setError(`Couldn't complete the reminder: ${err.message}`);
    }
  };

  const today = localDateKey(new Date());

  return (
    <div className="project-section">
      <h4 className="field-label">My Reminders</h4>
      <p className="private-note-hint" style={{ marginBottom: 10 }}>
        Reminders you attached to this project with + Add Reminder. Only you see these,
        finished ones included — they stay as a record of when you chased what.
      </p>

      {loadError && <p className="settings-status is-error">⚠ Couldn't load your reminders: {loadError}</p>}
      {!loadError && reminders.length === 0 && <p className="private-note-hint">No reminders attached to this project.</p>}

      {openOnly(reminders).map(r => (
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

      {/* Finished ones read as a log of what was chased and when -- the
          thing a project page could never answer while completing deleted
          the row. Still private: these are your reminders. */}
      {doneOnly(reminders).length > 0 && (
        <>
          <h4 className="field-label" style={{ marginTop: 14 }}>Done ({doneOnly(reminders).length})</h4>
          {doneOnly(reminders).map(r => (
            <div key={r.id} className="notes-history-item is-done">
              <div><Icon name="check" size={12} className="mark mark-won" /> {r.subject}</div>
              <div className="notes-history-date">{describeDone(r)}</div>
              {r.notes && <div className="notes-history-date" style={{ whiteSpace: "pre-wrap" }}>{r.notes}</div>}
            </div>
          ))}
        </>
      )}
      {error && <p className="settings-status is-error">{error}</p>}

      {ask && (
        <ConfirmDialog
          title="Mark this reminder complete?"
          confirmLabel="Mark complete"
          onCancel={() => setAsk(null)}
          onConfirm={ask.onConfirm}
        >
          <p>&quot;{ask.subject}&quot; moves to Done. It stays on this project and on your calendar on the day it was due.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
