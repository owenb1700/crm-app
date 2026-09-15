"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { localDateKey, weekdayKey } from "../../lib/closedProjects";

const fromKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// A signed-in user's own alert dates for one pipeline entry. They're stored
// as that user's private reminders (with pipelineId set), so they show up on
// that person's calendar, My Dashboard, and digest -- and nobody else's.
export default function PipelineMyAlerts({ pipeline, uid }) {
  const [alerts, setAlerts] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const snap = await getDocs(query(collection(db, "reminders"), where("userId", "==", uid)));
      setAlerts(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(r => r.pipelineId === pipeline.id)
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      );
      setLoadError("");
    } catch (err) {
      setLoadError(err.message || "Couldn't load your alerts.");
    }
  };

  useEffect(() => {
    if (uid && pipeline?.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, pipeline?.id]);

  const add = async () => {
    if (!date) return setError("Pick a date for the alert.");
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "reminders"), {
        userId: uid,
        pipelineId: pipeline.id,
        subject: `Pipeline: ${pipeline.title}`,
        date: weekdayKey(fromKey(date)),
        notes: note.trim() || null,
        createdAt: new Date().toISOString()
      });
      setDate("");
      setNote("");
      await load();
    } catch (err) {
      setError(`Couldn't add the alert: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteDoc(doc(db, "reminders", id));
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      setError(`Couldn't remove the alert: ${err.message}`);
    }
  };

  const today = localDateKey(new Date());

  return (
    <div className="project-section">
      <h4 className="field-label">My Alerts</h4>
      <p className="private-note-hint" style={{ marginBottom: 10 }}>
        Add your own alert dates for this entry, before or after the bid date{pipeline.bidDate ? ` (${pipeline.bidDate})` : ""}.
        Only you see these, on your calendar, My Dashboard, and digest emails. Reminders you attach to this entry from + Add Reminder show here too.
      </p>

      {loadError && <p className="settings-status is-error">⚠ Couldn't load your alerts: {loadError}</p>}
      {!loadError && alerts.length === 0 && <p className="private-note-hint">You haven't added any alerts for this entry.</p>}

      {alerts.map(a => (
        <div key={a.id} className="notes-history-item notes-history-row">
          <div>
            <div>
              <strong>{a.date}</strong>
              {a.date < today && <span className="role-badge" style={{ marginLeft: 8 }}>Past</span>}
            </div>
            {a.subject && a.subject !== `Pipeline: ${pipeline.title}` && <div>{a.subject}</div>}
            {a.notes && <div className="notes-history-date" style={{ whiteSpace: "pre-wrap" }}>{a.notes}</div>}
          </div>
          <button className="btn btn-secondary" onClick={() => remove(a.id)}>Remove</button>
        </div>
      ))}

      <div className="my-alert-add">
        <div>
          <label className="field-label" htmlFor={`my-alert-date-${pipeline.id}`}>Alert date</label>
          <input id={`my-alert-date-${pipeline.id}`} className="field" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor={`my-alert-note-${pipeline.id}`}>Note (optional)</label>
          <input
            id={`my-alert-note-${pipeline.id}`}
            className="field"
            autoComplete="off"
            placeholder="e.g. Call the engineer for addenda"
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") add(); }}
          />
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={add}>{saving ? "Adding…" : "Add Alert"}</button>
      </div>
      {error && <p className="settings-status is-error">{error}</p>}
    </div>
  );
}
