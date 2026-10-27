"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { localDateKey, weekdayKey } from "../../lib/closedProjects";
import ConfirmDialog from "./ConfirmDialog";
import { completedPayload, openOnly, doneOnly, describeDone } from "../../lib/reminders";
import { jobPeople } from "../../lib/jobPeople";
import { describeTeam } from "../../lib/pipelinePeople";
import Icon from "./Icon";

const fromKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// The signed-in user's own reminders attached to one project -- either set
// right here with + Add Reminder, or attached from the Home screen's own
// + Add Reminder. Reminders are private, so nobody else ever sees this
// list unless "Remind everyone on this project" is ticked when adding one.
export default function ProjectMyReminders({ project, projectId, uid, users = [] }) {
  const [reminders, setReminders] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [ask, setAsk] = useState(null);
  const [date, setDate] = useState("");
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [remindAll, setRemindAll] = useState(false);
  const [notice, setNotice] = useState("");

  // Everyone on the project, minus me -- I get the reminder either way.
  const team = jobPeople(project, { kind: "project", users, exclude: uid });
  const teamKnown = (users || []).length > 0;

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

  const addReminder = async () => {
    if (!subject.trim()) return setError("Give the reminder a subject.");
    if (!date) return setError("Pick a date for the reminder.");
    setSaving(true);
    setError("");
    setNotice("");
    try {
      // Reminders are private per person, so "remind everyone" writes one
      // each: mine, plus one for everybody on the project.
      const recipients = remindAll ? [uid, ...team.map(p => p.id)] : [uid];
      const stamp = new Date().toISOString();
      await Promise.all(recipients.map(userId => addDoc(collection(db, "reminders"), {
        userId,
        projectId,
        subject: subject.trim(),
        date, // saved on the day they picked, weekend included
        notes: note.trim() || null,
        // Says where a reminder someone didn't set came from.
        setBy: userId === uid ? null : uid,
        createdAt: stamp
      })));
      setSubject("");
      setDate("");
      setNote("");
      if (remindAll && team.length) {
        setNotice(`Reminder added for you and ${describeTeam(team, p => p.name)}.`);
      }
      await load();
    } catch (err) {
      setError(`Couldn't add the reminder: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const today = localDateKey(new Date());

  return (
    <div className="project-section">
      <h4 className="field-label">My Reminders</h4>
      <p className="private-note-hint" style={{ marginBottom: 10 }}>
        Reminders you attached to this project, here or from + Add Reminder on the Home screen. Only you see these,
        finished ones included — they stay as a record of when you chased what — unless you tick &quot;Remind everyone
        on this project&quot; below.
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

      <div className="my-alert-add" style={{ marginTop: 14 }}>
        <div>
          <label className="field-label" htmlFor={`my-reminder-subject-${projectId}`}>Subject</label>
          <input
            id={`my-reminder-subject-${projectId}`}
            className="field"
            autoComplete="off"
            placeholder="e.g. Call the contractor back"
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`my-reminder-date-${projectId}`}>Reminder date</label>
          <input id={`my-reminder-date-${projectId}`} className="field" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor={`my-reminder-note-${projectId}`}>Note (optional)</label>
          <input
            id={`my-reminder-note-${projectId}`}
            className="field"
            autoComplete="off"
            placeholder="e.g. Ask about the ship date"
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addReminder(); }}
          />
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={addReminder}>{saving ? "Adding…" : "Add Reminder"}</button>
      </div>

      {/* Always here, so it's findable even on a project that currently
          has nobody else on it. */}
      <label className="settings-check" htmlFor={`my-reminder-all-${projectId}`} style={{ marginTop: 8 }}>
        <input
          id={`my-reminder-all-${projectId}`}
          type="checkbox"
          disabled={!teamKnown || team.length === 0}
          checked={remindAll && teamKnown && team.length > 0}
          onChange={e => setRemindAll(e.target.checked)}
        />
        <span>
          Remind everyone on this project
          <span className="private-note-hint" style={{ margin: "0 0 0 6px" }}>
            {!teamKnown
              ? "checking who else is on this project…"
              : team.length
                ? `${describeTeam(team, p => p.name)} — everyone this project is assigned to or shared with`
                : "nobody else is on this project yet"}
          </span>
        </span>
      </label>

      {notice && <p className="private-note-hint">{notice}</p>}
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
