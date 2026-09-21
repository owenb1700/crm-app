"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";

// Notes on a pipeline entry, in two piles:
//
//   My notes   -- only the person who wrote them ever sees them.
//   Team notes -- anyone working the entry can read and add.
//
// Both are append-only: a note is never edited or overwritten, so the
// thread reads as a record of what was known when. Nothing is deleted when
// an entry is won, lost or converted -- the entry keeps its history and
// the project it becomes links back to it.
export default function PipelineNotes({ pipelineId, uid, myName, legacyNotes, legacyHistory }) {
  const [tab, setTab] = useState("team");
  const [mine, setMine] = useState([]);
  const [team, setTeam] = useState([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const mineRef = () => doc(db, "pipeline", pipelineId, "myNotes", uid);
  const teamRef = () => doc(db, "pipeline", pipelineId, "teamNotes", "data");

  const load = async () => {
    try {
      const [mineSnap, teamSnap] = await Promise.all([getDoc(mineRef()), getDoc(teamRef())]);
      setMine(mineSnap.exists() ? (mineSnap.data().entries || []) : []);
      setTeam(teamSnap.exists() ? (teamSnap.data().entries || []) : []);
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
        const entries = [...team, entry];
        await setDoc(teamRef(), { entries }, { merge: true });
        setTeam(entries);
      }
      setDraft("");
    } catch (err) {
      setError(`Couldn't save that note: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const shown = tab === "mine" ? mine : team;
  const older = tab === "team" ? [] : [
    // Notes written before this split existed were the owner's private
    // ones, so they belong under My notes rather than disappearing.
    ...(legacyNotes ? [{ text: legacyNotes, at: "", byName: "earlier note" }] : []),
    ...(legacyHistory || []).map(h => ({ text: h.text, at: h.date, byName: h.authorName || "earlier note" }))
  ];

  return (
    <div className="project-section detail-span-full">
      <div className="notes-tabs">
        <button
          type="button"
          className={`tab-btn ${tab === "team" ? "tab-btn-active" : ""}`}
          onClick={() => setTab("team")}
        >
          Team notes ({team.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === "mine" ? "tab-btn-active" : ""}`}
          onClick={() => setTab("mine")}
        >
          My notes ({mine.length + older.length})
        </button>
      </div>

      <p className="private-note-hint">
        {tab === "team"
          ? "Everyone working this entry can read and add to these."
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
        <div key={`${n.at}-${i}`} className="notes-history-item" style={{ marginTop: 10 }}>
          <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
          <div className="notes-history-date">
            {n.byName || "someone"}{n.at ? ` · ${String(n.at).slice(0, 10)}` : ""}
          </div>
        </div>
      ))}

      {older.length > 0 && (
        <>
          <p className="private-note-hint" style={{ marginTop: 14 }}>Before notes were split in two:</p>
          {older.map((n, i) => (
            <div key={`older-${i}`} className="notes-history-item" style={{ marginTop: 10 }}>
              <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
              <div className="notes-history-date">
                {n.byName}{n.at ? ` · ${String(n.at).slice(0, 10)}` : ""}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
