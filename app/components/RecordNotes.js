"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import ConfirmDialog from "./ConfirmDialog";
import NoteAlertPicker from "./NoteAlertPicker";
import { jobPeople, noteAlertMessage } from "../../lib/jobPeople";
import { notifyUsers } from "../../lib/notify";

// Notes on a project: one document each, added by whoever owns or
// collaborates on it, never edited afterwards, and deletable only by the
// person who wrote the note. The Firestore rule checks the author, so
// that holds whether someone goes through this page or around it.
//
// Older notes, written before notes were kept as a thread, are shown
// underneath so nothing is lost.
export default function RecordNotes({
  collectionName, recordId, uid, myName, canAdd, legacyNotes, legacyHistory, onDeleteLegacy,
  // For the "who should know?" step. Without a record and a user list
  // there is nobody to offer, and the note saves the way it always did.
  record, users = [], recordKind = "project", recordTitle, recordLink
}) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState("");
  // Pressing Add note opens the "who should know?" step; the note isn't
  // written until Add note is pressed again from in there.
  const [choosing, setChoosing] = useState(false);

  const people = jobPeople(record, { kind: recordKind, users, exclude: uid });
  // Only a job has people on it. A parts request uses this same thread and
  // has nobody to tell, so it saves on the first press the way it always
  // did rather than asking a question with no answers in it.
  const asksWhoToTell = !!record;

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

  const add = async (tell = []) => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const entry = { text, by: uid, byName: myName, at: new Date().toISOString() };
      const ref = await addDoc(notesCol(), entry);
      setNotes(prev => [...prev, { id: ref.id, ...entry }]);
      setDraft("");
      setChoosing(false);
      // The note is saved either way. A notification that doesn't go out
      // is worth saying so about, but not worth losing the note over.
      if (tell.length) {
        try {
          await notifyUsers(tell, {
            type: "note",
            message: noteAlertMessage(myName, recordTitle),
            link: recordLink
          });
        } catch {
          setError("Note saved, but the alert didn't go out.");
        }
      }
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
          {choosing ? (
            <NoteAlertPicker
              people={people}
              busy={busy}
              onCancel={() => setChoosing(false)}
              onAdd={add}
            />
          ) : (
            <button
              className="btn btn-primary"
              disabled={busy || !draft.trim()}
              onClick={() => (asksWhoToTell ? setChoosing(true) : add())}
            >
              {busy ? "Saving…" : "Add note"}
            </button>
          )}
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
