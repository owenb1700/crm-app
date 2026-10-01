"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { checkInUpdatePayload, snoozePayload, localDateKey, SNOOZE_OPTIONS, snoozeMonthsPayload, stopCheckInsPayload, hasCheckInsComing } from "../../lib/closedProjects";

// Update / Snooze buttons for a closed project's check-in. Update requires
// saying who you checked in with and moves on to the next date the plan
// asked for; Snooze just moves this one.
//
// A check-in that has come back is not always wrong, only early -- so the
// snooze offers two months, a year, two years, a date of your own, or
// indefinitely for the jobs that are genuinely finished with. Every
// action is written to the project's activity log, including stopping.
export default function ClosedCheckInActions({ project, byName, onDone }) {
  const [mode, setMode] = useState(null); // null | "update" | "snooze"
  const [person, setPerson] = useState("");
  const [notes, setNotes] = useState("");
  const [snoozeDate, setSnoozeDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setMode(null);
    setPerson("");
    setNotes("");
    setSnoozeDate("");
    setError("");
  };

  const write = async (payload, message) => {
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "customers", project.id), payload);
      close();
      onDone?.(message, payload);
    } catch (err) {
      setError(`Couldn't save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const submitUpdate = () => {
    if (!person.trim()) return setError("Enter who you checked in with.");
    const payload = checkInUpdatePayload(project, { person: person.trim(), notes: notes.trim(), byName });
    write(payload, `Check-in logged — next one ${payload.nextCheckIn}`);
  };

  const snoozeMonths = (months) => {
    const payload = snoozeMonthsPayload(project, { months, byName });
    write(payload, `Snoozed to ${payload.nextCheckIn}`);
  };

  const submitSnoozeDate = () => {
    if (!snoozeDate) return setError("Pick a date.");
    if (snoozeDate <= localDateKey(new Date())) return setError("Pick a date after today.");
    const payload = snoozePayload(project, { dateKey: snoozeDate, byName });
    write(payload, `Snoozed to ${payload.nextCheckIn}`);
  };

  const stopForGood = () => {
    write(stopCheckInsPayload(project, { byName }), "Check-ins stopped for this job");
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
        <button className="btn btn-primary" disabled={saving || !hasCheckInsComing(project)} onClick={() => setMode("update")}>Update</button>
        <button className="btn btn-secondary" disabled={saving} onClick={() => setMode("snooze")}>Snooze</button>
      </div>
      {error && !mode && <p className="settings-status is-error">{error}</p>}

      {mode && (
        <div className="modal-overlay" onClick={e => { e.stopPropagation(); close(); }}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={close} aria-label="Close">✕</button>

            {mode === "update" ? (
              <>
                <h3 className="modal-title">Log a check-in</h3>
                <p className="modal-subtitle" style={{ marginBottom: 12 }}>
                  {project.projectName || project.company} — logging this moves on to the next check-in the plan asked for.
                </p>
                <label className="field-label" htmlFor={`checkin-person-${project.id}`}>Who did you check in with?</label>
                <input
                  id={`checkin-person-${project.id}`}
                  className="field"
                  autoComplete="off"
                  autoFocus
                  placeholder="e.g. Jane Smith at ABC Mechanical"
                  value={person}
                  onChange={e => setPerson(e.target.value)}
                />
                <label className="field-label" htmlFor={`checkin-notes-${project.id}`}>Notes (optional)</label>
                <textarea
                  id={`checkin-notes-${project.id}`}
                  className="field"
                  style={{ width: "100%", height: 80 }}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </>
            ) : (
              <>
                <h3 className="modal-title">Snooze check-in</h3>
                <p className="modal-subtitle" style={{ marginBottom: 12 }}>
                  {project.projectName || project.company} — when should this come up again?
                </p>
                <div className="reason-picker">
                  {SNOOZE_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      className="btn btn-secondary"
                      disabled={saving}
                      onClick={() => snoozeMonths(opt.months)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <label className="field-label" htmlFor={`checkin-snooze-${project.id}`}>Or pick your own date</label>
                <input
                  id={`checkin-snooze-${project.id}`}
                  className="field"
                  type="date"
                  value={snoozeDate}
                  onChange={e => { setSnoozeDate(e.target.value); setError(""); }}
                />

                {/* Last, and on its own, because it is the one that can't
                    be undone by waiting. */}
                {hasCheckInsComing(project) && (
                  <>
                    <label className="field-label" style={{ marginTop: 14 }}>Done with this one</label>
                    <button className="btn btn-secondary btn-block" disabled={saving} onClick={stopForGood}>
                      Stop asking about this job
                    </button>
                    <p className="private-note-hint">
                      Clears this check-in and the rest of the plan. You can set a new date any time.
                    </p>
                  </>
                )}
              </>
            )}

            {error && <p className="settings-status is-error">{error}</p>}

            <div className="modal-actions">
              <button className="btn btn-primary" disabled={saving || (mode === "snooze" && !snoozeDate)} onClick={mode === "update" ? submitUpdate : submitSnoozeDate}>
                {saving ? "Saving…" : mode === "update" ? "Log Check-In" : snoozeDate ? `Snooze to ${snoozeDate}` : "Pick a date first"}
              </button>
              <button className="btn btn-secondary" onClick={close}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
