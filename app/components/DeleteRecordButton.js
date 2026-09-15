"use client";

import { useState } from "react";
import { auth } from "../../lib/firebase";

// A Delete button with a confirmation popup, for projects and pipeline
// entries. The actual delete (and cleanup of everything attached) happens
// server-side at /api/delete-record.
export default function DeleteRecordButton({ kind, id, name, onDeleted, className = "btn btn-danger", label = "Delete" }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const noun = kind === "project" ? "project" : "pipeline entry";
  const attached = kind === "project"
    ? "its notes and note history, drawings, activity, check-ins, and collaboration requests"
    : "its notes, uploaded files, everyone's alerts for it, and its bid details";

  const run = async () => {
    setDeleting(true);
    setError("");
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/delete-record", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ kind, id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.code ? `${data.error} (code ${data.code})` : data.error || "Delete failed");
      setConfirming(false);
      onDeleted?.(data.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <button type="button" className={className} onClick={(e) => { e.stopPropagation(); setConfirming(true); }}>{label}</button>

      {confirming && (
        <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); if (!deleting) setConfirming(false); }}>
          <div className="modal-card" role="alertdialog" aria-labelledby="delete-record-title" onClick={e => e.stopPropagation()}>
            <h3 id="delete-record-title" className="modal-title">Delete this {noun}?</h3>
            <p style={{ margin: "6px 0 10px", fontWeight: 600 }}>{name}</p>
            <p className="modal-subtitle" style={{ fontSize: 13, lineHeight: 1.5 }}>
              This permanently deletes the {noun} along with {attached}. It can't be undone.
            </p>
            {error && <p className="settings-status is-error">{error}</p>}
            <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" disabled={deleting} onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="btn btn-danger-solid" disabled={deleting} onClick={run}>
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
