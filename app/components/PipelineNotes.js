"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import ConfirmDialog from "./ConfirmDialog";

// Notes on a pipeline entry, in two piles:
//
//   My notes   -- only the person who wrote them ever sees them.
//   Team notes -- anyone working the entry can read and add.
//
// You can delete a note you wrote, after confirming, and it's gone for
// good -- no tombstone, no "deleted by" line. You can never delete
// anyone else's: team notes are one document each, and the Firestore rule
// checks the author, so it isn't down to this page to be careful.
//
// Nothing is removed when an entry is won, lost or converted; the entry
// keeps its notes and the project it becomes links back to it.
export default function PipelineNotes({ pipelineId, uid, myName, legacyNotes, legacyHistory }) {
  const [tab, setTab] = useState("team");
  const [mine, setMine] = useState([]);
  const [team, setTeam] = useState([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(null); // { scope, note }
  const [error, setError] = useState("");

  const mineRef = () => doc(db, "pipeline", pipelineId, "myNotes", uid);
  const teamCol = () => collection(db, "pipeline", pipelineId, "teamNotes");

  const load = async () => {
    try {
      const [mineSnap, teamSnap] = await Promise.all([getDoc(mineRef()), getDocs(teamCol())]);
      setMine(mineSnap.exists() ? (mineSnap.data().entries || []) : []);
      setTeam(
        teamSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
      );
      setError("");
    } catch (err) {
      setError(err.message || "Couldn't load notes.");
    }
  };

  useEffect(() => {
    if (pipelineId && uid) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, uid]);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    setError("");
    try {
      const entry = { text, by: uid, byName: myName, at: new Date().toISOString() };
      if (tab === "mine") {
        const entries = [...mine, entry];
        await setDoc(mineRef(), { entries, userId: uid }, { merge: true });
        setMine(entries);
      } else {
        await addDoc(teamCol(), entry);
        await load();
      }
      setDraft("");
    } catch (err) {
      setError(`Couldn't save that note: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const { scope, note } = confirming;
    setSaving(true);
    try {
      if (scope === "mine") {
        const entries = mine.filter(n => !(n.at === note.at && n.text === note.text));
        await setDoc(mineRef(), { entries, userId: uid }, { merge: true });
        setMine(entries);
      } else {
        await deleteDoc(doc(db, "pipeline", pipelineId, "teamNotes", note.id));
        setTeam(prev => prev.filter(n => n.id !== note.id));
      }
      setConfirming(null);
    } catch (err) {
      setError(`Couldn't delete that note: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const older = tab === "team" ? [] : [
    // Notes written before this split existed were the owner's private
    // ones, so they belong under My notes rather than disappearing.
    ...(legacyNotes ? [{ text: legacyNotes, at: "", byName: "earlier note" }] : []),
    ...(legacyHistory || []).map(h => ({ text: h.text, at: h.date, byName: h.authorName || "earlier note" }))
  ];
  const shown = tab === "mine" ? mine : team;

  return (
    <div className="project-section detail-span-full">
      <div className="notes-tabs">
        <button type="button" className={`tab-btn ${tab === "team" ? "tab-btn-active" : ""}`} onClick={() => setTab("team")}>
          Team notes ({team.length})
        </button>
        <button type="button" className={`tab-btn ${tab === "mine" ? "tab-btn-active" : ""}`} onClick={() => setTab("mine")}>
          My notes ({mine.length + older.length})
        </button>
      </div>

      <p className="private-note-hint">
        {tab === "team"
          ? "Everyone working this entry can read and add to these. You can delete your own."
          : "Only you can see these, even after this entry becomes a project."}
      </p>

      <textarea
        className="field"
        style={{ width: "100%", height: 80 }}
        placeholder={tab === "team" ? "Add a note for the team..." : "Add a note for yourself..."}
        value={draft}
        onChange={e => setDraft(e.target.value)}
      />
      <button className="btn btn-primary" disabled={saving || !draft.trim()} onClick={add}>
        {saving ? "Saving…" : "Add note"}
      </button>

      {error && <p className="settings-status is-error">{error}</p>}

      {shown.length === 0 && older.length === 0 && (
        <p className="private-note-hint" style={{ marginTop: 10 }}>No notes yet.</p>
      )}

      {[...shown].reverse().map((n, i) => (
        <div key={n.id || `${n.at}-${i}`} className="notes-history-item notes-history-row" style={{ marginTop: 10 }}>
          <div>
            <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
            <div className="notes-history-date">
              {n.byName || "someone"}{n.at ? ` · ${String(n.at).slice(0, 10)}` : ""}
            </div>
          </div>
          {(tab === "mine" || n.by === uid) && (
            <button className="btn btn-secondary" onClick={() => setConfirming({ scope: tab, note: n })}>Delete</button>
          )}
        </div>
      ))}

      {older.length > 0 && (
        <>
          <p className="private-note-hint" style={{ marginTop: 14 }}>Before notes were split in two:</p>
          {older.map((n, i) => (
            <div key={`older-${i}`} className="notes-history-item" style={{ marginTop: 10 }}>
              <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
              <div className="notes-history-date">{n.byName}{n.at ? ` · ${String(n.at).slice(0, 10)}` : ""}</div>
            </div>
          ))}
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title="Delete this note?"
          confirmLabel="Delete"
          danger
          busy={saving}
          onConfirm={remove}
          onCancel={() => setConfirming(null)}
        >
          <p className="modal-subtitle">It&apos;s gone for good — no copy is kept.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
