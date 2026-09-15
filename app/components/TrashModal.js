"use client";

import { useEffect, useState } from "react";
import { auth } from "../../lib/firebase";
import { TRASH_DAYS, daysLeftInTrash } from "../../lib/trash";
import ConfirmDialog from "./ConfirmDialog";

// Other open pages (the dashboard) listen for this to reload their lists.
export const RECORDS_CHANGED_EVENT = "crm:records-changed";

const authedFetch = async (url, options = {}) => {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}`, ...(options.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.code ? `${data.error} (code ${data.code})` : data.error || "Something went wrong");
  return data;
};

// The Trash, opened from User Settings: deleted projects and pipeline
// entries (your own, or everyone's for an admin), each restorable until its
// 30 days run out.
export default function TrashModal({ onClose }) {
  const [items, setItems] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null); // { text, link }
  const [error, setError] = useState("");
  const [confirmPurge, setConfirmPurge] = useState(null);

  const load = async () => {
    try {
      const data = await authedFetch("/api/trash");
      setItems(data.items);
      setIsAdmin(data.isAdmin);
      setLoadError("");
    } catch (err) {
      setLoadError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (item, action) => {
    setBusyId(item.id);
    setError("");
    setNotice(null);
    try {
      await authedFetch("/api/delete-record", { method: "POST", body: JSON.stringify({ kind: item.kind, id: item.id, action }) });
      setItems(prev => prev.filter(i => i.id !== item.id));
      setConfirmPurge(null);
      if (action === "restore") {
        setNotice({
          text: `Restored "${item.name}"`,
          link: item.kind === "project" ? `/dashboard/project/${item.id}` : `/dashboard/pipeline/${item.id}`
        });
        window.dispatchEvent(new Event(RECORDS_CHANGED_EVENT));
      } else {
        setNotice({ text: `Deleted "${item.name}" forever` });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="modal-overlay confirm-overlay" onClick={onClose}>
      <div className="modal-card trash-modal" role="dialog" aria-modal="true" aria-labelledby="trash-title" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h3 id="trash-title" className="modal-title" style={{ margin: 0 }}>Trash</h3>
            <p className="settings-hint" style={{ margin: "2px 0 0" }}>
              {isAdmin ? "Every deleted project and pipeline entry." : "Projects and pipeline entries you deleted."}{" "}
              Each is deleted forever {TRASH_DAYS} days after it was deleted.
            </p>
          </div>
          <button className="modal-close" style={{ position: "static" }} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="trash-body">
          {notice && (
            <p className="settings-status is-ok">
              {notice.text}
              {notice.link && <> — <a className="link-muted" href={notice.link}>Open it</a></>}
            </p>
          )}
          {error && <p className="settings-status is-error">{error}</p>}
          {loadError && <p className="settings-status is-error">Couldn&apos;t load the trash: {loadError}</p>}
          {!loadError && items === null && <p className="private-note-hint">Loading…</p>}
          {items && items.length === 0 && <p className="private-note-hint">The trash is empty.</p>}

          {(items || []).map(item => {
            const days = daysLeftInTrash(item);
            return (
              <div key={`${item.kind}-${item.id}`} className="trash-row">
                <div className="trash-row-info">
                  <div className="trash-row-title">
                    <span className={`role-badge ${item.kind === "pipeline" ? "role-badge-admin" : ""}`}>
                      {item.kind === "pipeline" ? "Pipeline" : "Project"}
                    </span>
                    <strong>{item.name}</strong>
                  </div>
                  {item.sub && <div className="notes-history-date">{item.sub}</div>}
                  <div className="notes-history-date">
                    Deleted {String(item.deletedAt).slice(0, 10)}
                    {isAdmin ? ` by ${item.deletedBy} · owner ${item.owner}` : ""}
                  </div>
                  <div className={`trash-days ${days <= 3 ? "is-soon" : ""}`}>
                    {days === 0 ? "Deleting forever today" : `${days} day${days === 1 ? "" : "s"} left`}
                  </div>
                </div>
                <div className="trash-row-actions">
                  <button className="btn btn-primary" disabled={busyId === item.id} onClick={() => act(item, "restore")}>Restore</button>
                  <button className="btn btn-danger" disabled={busyId === item.id} onClick={() => setConfirmPurge(item)}>Delete forever</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirmPurge && (
        <div onClick={e => e.stopPropagation()}>
        <ConfirmDialog
          title={`Delete "${confirmPurge.name}" forever?`}
          confirmLabel="Delete forever"
          danger
          busy={busyId === confirmPurge.id}
          onCancel={() => setConfirmPurge(null)}
          onConfirm={() => act(confirmPurge, "purge")}
        >
          <p>This removes it and everything attached to it (notes, files, reminders) right now. It can&apos;t be undone.</p>
        </ConfirmDialog>
        </div>
      )}
    </div>
  );
}
