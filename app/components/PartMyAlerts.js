"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { localDateKey } from "../../lib/closedProjects";

// Your own alert dates for one parts request. Parts raise nothing on their
// own -- nobody is emailed, nobody's calendar fills up because someone
// else ordered a coil. An alert exists only because you set it, and only
// you ever see it: it's stored as your private reminder with partId set,
// so it shows on your calendar, My Projects and digest like any other.
export default function PartMyAlerts({ part, uid }) {
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
          .filter(r => r.partId === part.id)
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      );
      setLoadError("");
    } catch (err) {
      setLoadError(err.message || "Couldn't load your alerts.");
    }
  };

  useEffect(() => {
    if (uid && part?.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, part?.id]);

  const add = async () => {
    if (!date) return setError("Pick a date for the alert.");
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "reminders"), {
        userId: uid,
        partId: part.id,
        subject: `Parts: ${part.item}`,
        date, // the day you picked, weekend included
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
        Parts don&apos;t alert anyone by themselves. Set your own date here{part.neededBy ? ` — it's needed by ${part.neededBy}` : ""} and
        it shows on your calendar, My Projects and digest emails. Only you see it.
      </p>

      {loadError && <p className="settings-status is-error">⚠ Couldn&apos;t load your alerts: {loadError}</p>}
      {!loadError && alerts.length === 0 && <p className="private-note-hint">You haven&apos;t set any alerts for this request.</p>}

      {alerts.map(a => (
        <div key={a.id} className="notes-history-item notes-history-row">
          <div>
            <div>
              <strong>{a.date}</strong>
              {a.date < today && <span className="role-badge" style={{ marginLeft: 8 }}>Past</span>}
            </div>
            {a.notes && <div className="notes-history-date" style={{ whiteSpace: "pre-wrap" }}>{a.notes}</div>}
          </div>
          <button className="btn btn-secondary" onClick={() => remove(a.id)}>Remove</button>
        </div>
      ))}

      <div className="my-alert-add">
        <div>
          <label className="field-label" htmlFor={`part-alert-date-${part.id}`}>Alert date</label>
          <input id={`part-alert-date-${part.id}`} className="field" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor={`part-alert-note-${part.id}`}>Note (optional)</label>
          <input
            id={`part-alert-note-${part.id}`}
            className="field"
            autoComplete="off"
            placeholder="e.g. Chase the supplier for a ship date"
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
