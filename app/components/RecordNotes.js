"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import ConfirmDialog from "./ConfirmDialog";

// Notes on a project: one document each, added by whoever owns or
// collaborates on it, never edited afterwards, and deletable only by the
// person who wrote the note. The Firestore rule checks the author, so
// that holds whether someone goes through this page or around it.
//
// Older notes, written before notes were kept as a thread, are shown
// underneath so nothing is lost.
export default function RecordNotes({
  collectionName, recordId, uid, myName, canAdd, legacyNotes, legacyHistory, onDeleteLegacy
}) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState("");

  const notesCol = () => collection(db, collectionName, recordId, "notes");

  const load = async () => {
    try {
      const snap = await getDocs(notesCol());
      setNotes(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
      );
      setError("");
    } catch (err) {
      setError(err.message || "Couldn't load notes.");
    }
  };

  useEffect(() => {
    if (recordId && uid) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, recordId, uid]);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const entry = { text, by: uid, byName: myName, at: new Date().toISOString() };
      const ref = await addDoc(notesCol(), entry);
      setNotes(prev => [...prev, { id: ref.id, ...entry }]);
      setDraft("");
    } catch (err) {
      setError(`Couldn't save that note: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      if (confirming.legacyIndex !== undefined) {
        await onDeleteLegacy(confirming.legacyIndex);
      } else {
        await deleteDoc(doc(db, collectionName, recordId, "notes", confirming.id));
        setNotes(prev => prev.filter(n => n.id !== confirming.id));
      }
      setConfirming(null);
    } catch (err) {
      setError(`Couldn't delete that note: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const older = [
    ...(legacyNotes ? [{ text: legacyNotes, date: "", authorName: "earlier note" }] : []),
    ...(legacyHistory || [])
  ];

  return (
    <>
      {canAdd && (
        <>
          <textarea
            className="field"
            style={{ width: "100%", height: 90 }}
            placeholder="Add a note..."
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={add}>
            {busy ? "Saving…" : "Add note"}
          </button>
        </>
      )}

      {error && <p className="settings-status is-error">{error}</p>}

      {notes.length === 0 && older.length === 0 && (
        <p className="private-note-hint" style={{ marginTop: 10 }}>No notes yet.</p>
      )}

      {[...notes].reverse().map(n => (
        <div key={n.id} className="notes-history-item notes-history-row" style={{ marginTop: 10 }}>
          <div>
            <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
            <div className="notes-history-date">
              {n.byName || "someone"}{n.at ? ` · ${String(n.at).slice(0, 10)}` : ""}
            </div>
          </div>
          {/* Your own only. */}
          {n.by === uid && (
            <button className="btn btn-secondary" onClick={() => setConfirming(n)}>Delete</button>
          )}
        </div>
      ))}

      {older.length > 0 && (
        <>
          <p className="private-note-hint" style={{ marginTop: 14 }}>Earlier notes:</p>
          {older.map((h, i) => (
            <div key={`older-${i}`} className="notes-history-item notes-history-row" style={{ marginTop: 10 }}>
              <div>
                <div style={{ whiteSpace: "pre-wrap" }}>{h.text}</div>
                <div className="notes-history-date">{h.authorName || "Unknown"}{h.date ? ` · ${String(h.date).slice(0, 10)}` : ""}</div>
              </div>
              {h.authorId === uid && onDeleteLegacy && (
                <button className="btn btn-secondary" onClick={() => setConfirming({ ...h, legacyIndex: i - (legacyNotes ? 1 : 0) })}>Delete</button>
              )}
            </div>
          ))}
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title="Delete this note?"
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(null)}
        >
          <p className="modal-subtitle">It&apos;s gone for good — no copy is kept.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
