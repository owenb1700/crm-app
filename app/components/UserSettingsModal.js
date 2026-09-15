"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { DAY_NAMES, DEFAULT_DIGEST_SCHEDULE, schedulesFor } from "../../lib/digest";
import TrashModal from "./TrashModal";

// The one User Settings window, opened from the avatar menu on every page.
// Edits are held locally until Save, so Cancel (or ✕) really discards them.
export default function UserSettingsModal({ uid, profile, onClose, onSaved }) {
  const [showTrash, setShowTrash] = useState(false);
  const [schedules, setSchedules] = useState(() => schedulesFor(profile).map(s => ({ ...s })));
  const [notifyCollabRequest, setNotifyCollabRequest] = useState(profile?.notifyCollabRequest !== false);
  const [notifyCollabApproved, setNotifyCollabApproved] = useState(profile?.notifyCollabApproved !== false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [testStatus, setTestStatus] = useState(null); // null | "sending" | { ok, message }

  const updateSchedule = (index, field, value) => {
    setSchedules(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const save = async () => {
    setSaving(true);
    setSaveError("");
    const patch = {
      digestSchedules: schedules.map(s => ({
        dayOfWeek: Number(s.dayOfWeek),
        daysAhead: Math.min(60, Math.max(1, Number(s.daysAhead) || 1)),
        includeOverdue: s.includeOverdue !== false
      })),
      notifyCollabRequest,
      notifyCollabApproved
    };
    try {
      await updateDoc(doc(db, "users", uid), patch);
      onSaved?.(patch);
      onClose();
    } catch (err) {
      setSaveError(`Couldn't save your settings: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const sendTestDigest = async () => {
    setTestStatus("sending");
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/send-test-digest", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.code ? `${data.error} (code ${data.code})` : data.error || "Failed to send");
      setTestStatus({ ok: true, message: `Sent to ${data.email}` });
    } catch (err) {
      setTestStatus({ ok: false, message: err.message || "Couldn't send the test digest" });
    }
  };

  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card settings-modal" role="dialog" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h3 id="settings-title" className="modal-title" style={{ margin: 0 }}>User Settings</h3>
            <p className="settings-hint" style={{ margin: "2px 0 0" }}>
              {name ? `${name} · ` : ""}{auth.currentUser?.email}
            </p>
          </div>
          <button className="modal-close" style={{ position: "static" }} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h4 className="settings-section-title">Digest emails</h4>
            <p className="settings-hint">
              A summary of your reminders, projects, and follow-ups. Each digest sends at 4:00 AM Central on its day.
            </p>

            {schedules.length === 0 && (
              <div className="digest-empty">You don't have any digest emails scheduled.</div>
            )}

            {schedules.map((s, i) => (
              <div key={i} className="digest-card">
                <div className="digest-card-top">
                  <label className="digest-inline" htmlFor={`digest-day-${i}`}>
                    <span>Every</span>
                    <select
                      id={`digest-day-${i}`}
                      className="field digest-select"
                      value={s.dayOfWeek}
                      onChange={e => updateSchedule(i, "dayOfWeek", Number(e.target.value))}
                    >
                      {DAY_NAMES.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="settings-link settings-link-danger"
                    onClick={() => setSchedules(prev => prev.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </button>
                </div>

                <label className="digest-inline" htmlFor={`digest-days-${i}`}>
                  <span>Include items due in the next</span>
                  <input
                    id={`digest-days-${i}`}
                    type="number"
                    min={1}
                    max={60}
                    className="field digest-number"
                    value={s.daysAhead}
                    onChange={e => updateSchedule(i, "daysAhead", e.target.value)}
                  />
                  <span>days</span>
                </label>

                <label className="settings-check" htmlFor={`digest-overdue-${i}`}>
                  <input
                    id={`digest-overdue-${i}`}
                    type="checkbox"
                    checked={s.includeOverdue !== false}
                    onChange={e => updateSchedule(i, "includeOverdue", e.target.checked)}
                  />
                  <span>Also include overdue items</span>
                </label>
              </div>
            ))}

            <div className="settings-row-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSchedules(prev => [...prev, { ...DEFAULT_DIGEST_SCHEDULE }])}
              >
                + Add digest
              </button>
              <button
                type="button"
                className="settings-link"
                disabled={testStatus === "sending"}
                onClick={sendTestDigest}
              >
                {testStatus === "sending" ? "Sending test…" : "Send me a test digest"}
              </button>
            </div>
            {testStatus && testStatus !== "sending" && (
              <p className={`settings-status ${testStatus.ok ? "is-ok" : "is-error"}`}>{testStatus.message}</p>
            )}
            <p className="settings-hint" style={{ marginTop: 6 }}>
              The test covers the next 7 days plus anything overdue, using your saved data.
            </p>
          </section>

          <section className="settings-section">
            <h4 className="settings-section-title">Trash</h4>
            <p className="settings-hint">
              {profile?.role === "admin"
                ? "Every deleted project and pipeline entry, kept for 30 days before it's deleted forever."
                : "Your deleted projects and pipeline entries, kept for 30 days before they're deleted forever."}
            </p>
            <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setShowTrash(true)}>
              Open Trash
            </button>
          </section>

          <section className="settings-section">
            <h4 className="settings-section-title">Collaboration emails</h4>
            <p className="settings-hint">Email me when:</p>
            <label className="settings-check" htmlFor="notify-collab-request">
              <input
                id="notify-collab-request"
                type="checkbox"
                checked={notifyCollabRequest}
                onChange={e => setNotifyCollabRequest(e.target.checked)}
              />
              <span>Someone asks to collaborate on one of my projects</span>
            </label>
            <label className="settings-check" htmlFor="notify-collab-approved">
              <input
                id="notify-collab-approved"
                type="checkbox"
                checked={notifyCollabApproved}
                onChange={e => setNotifyCollabApproved(e.target.checked)}
              />
              <span>My request to collaborate is approved</span>
            </label>
            <p className="settings-hint" style={{ marginTop: 6 }}>These always show in the alerts bell either way.</p>
          </section>
        </div>

        {showTrash && <TrashModal onClose={() => setShowTrash(false)} />}

        <div className="settings-footer">
          {saveError && <p className="settings-status is-error" style={{ margin: 0, marginRight: "auto" }}>{saveError}</p>}
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
