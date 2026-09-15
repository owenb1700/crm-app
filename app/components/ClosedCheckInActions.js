"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { checkInUpdatePayload, snoozePayload, yearsFrom, localDateKey, UPDATE_CHECK_IN_YEARS } from "../../lib/closedProjects";

// Update / Snooze buttons for a closed project's check-in. Update requires
// saying who you checked in with and resets the check-in to 2 years out;
// Snooze 1 Year or Pick a date just moves it. Every action is written to
// the project's activity log so the history of check-ins is kept.
export default function ClosedCheckInActions({ project, byName, onDone, compact = false }) {
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

  const snoozeYear = () => {
    const payload = snoozePayload(project, { dateKey: yearsFrom(new Date(), 1), byName });
    write(payload, `Snoozed to ${payload.nextCheckIn}`);
  };

  const submitSnoozeDate = () => {
    if (!snoozeDate) return setError("Pick a date.");
    if (snoozeDate <= localDateKey(new Date())) return setError("Pick a date after today.");
    const payload = snoozePayload(project, { dateKey: snoozeDate, byName });
    write(payload, `Snoozed to ${payload.nextCheckIn}`);
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
        <button className="btn btn-primary" disabled={saving} onClick={() => setMode("update")}>Update</button>
        <button className="btn btn-secondary" disabled={saving} onClick={snoozeYear}>{compact ? "Snooze 1 Yr" : "Snooze 1 Year"}</button>
        <button className="btn btn-secondary" disabled={saving} onClick={() => setMode("snooze")}>Pick a date</button>
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
                  {project.projectName || project.company} — the next check-in will be set {UPDATE_CHECK_IN_YEARS} years out.
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
                <p className="modal-subtitle" style={{ marginBottom: 12 }}>Choose when this check-in should come up again.</p>
                <label className="field-label" htmlFor={`checkin-snooze-${project.id}`}>Next check-in date</label>
                <input
                  id={`checkin-snooze-${project.id}`}
                  className="field"
                  type="date"
                  value={snoozeDate}
                  onChange={e => setSnoozeDate(e.target.value)}
                />
              </>
            )}

            {error && <p className="settings-status is-error">{error}</p>}

            <div className="modal-actions">
              <button className="btn btn-primary" disabled={saving} onClick={mode === "update" ? submitUpdate : submitSnoozeDate}>
                {saving ? "Saving…" : mode === "update" ? "Log Check-In" : "Snooze"}
              </button>
              <button className="btn btn-secondary" onClick={close}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
