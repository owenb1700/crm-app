"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { localDateKey } from "../../lib/closedProjects";
import { remindableTeam, describeTeam } from "../../lib/pipelinePeople";
import { personName } from "../../lib/people";

// A signed-in user's own alert dates for one pipeline entry. They're stored
// as that user's private reminders (with pipelineId set), so they show up on
// that person's calendar, My Projects, and digest -- and nobody else's.
export default function PipelineMyAlerts({ pipeline, uid, users = [] }) {
  const [alerts, setAlerts] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [remindAll, setRemindAll] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Everyone on the entry, minus me -- I get the alert either way.
  const team = remindableTeam(pipeline, users).filter(u => u.id !== uid);

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
    setNotice("");
    try {
      // Reminders are private per person, so "remind everyone" writes one
      // each: mine, plus one for everybody working the entry.
      const recipients = remindAll ? [uid, ...team.map(u => u.id)] : [uid];
      const stamp = new Date().toISOString();
      await Promise.all(recipients.map(userId => addDoc(collection(db, "reminders"), {
        userId,
        pipelineId: pipeline.id,
        subject: `Pipeline: ${pipeline.title}`,
        date, // saved on the day they picked, weekend included
        notes: note.trim() || null,
        // Says where a reminder someone didn't set came from.
        setBy: userId === uid ? null : uid,
        createdAt: stamp
      })));
      setDate("");
      setNote("");
      if (remindAll && team.length) {
        setNotice(`Alert added for you and ${describeTeam(team, personName)}.`);
      }
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
        Only you see these, on your calendar, My Projects, and digest emails. Reminders you attach to this entry from + Add Reminder show here too.
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

      {/* Always here, so it's findable even on an entry that currently has
          nobody else on it. */}
      <label className="settings-check" htmlFor={`my-alert-all-${pipeline.id}`} style={{ marginTop: 8 }}>
        <input
          id={`my-alert-all-${pipeline.id}`}
          type="checkbox"
          disabled={team.length === 0}
          checked={remindAll && team.length > 0}
          onChange={e => setRemindAll(e.target.checked)}
        />
        <span>
          Remind everyone on this entry
          <span className="private-note-hint" style={{ margin: "0 0 0 6px" }}>
            {team.length
              ? `${describeTeam(team, personName)} — everyone this entry is assigned to or shared with, plus the reps on the bidding firms`
              : "nobody else is on this entry yet"}
          </span>
        </span>
      </label>

      {notice && <p className="private-note-hint">{notice}</p>}
      {error && <p className="settings-status is-error">{error}</p>}
    </div>
  );
}
