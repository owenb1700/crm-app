"use client";

import { useState } from "react";
import { BUILDING_SECTORS } from "../../lib/directory";
import { saveBuildingSector, teachFirmsAboutSectors } from "../../lib/saveBuildingSector";

// What sort of building this is, set on the building itself.
//
// Saving it also tells the firms who have worked here that they do this
// kind of work, which is the whole point: nobody is going to keep a list
// of which contractors have done hospitals, but the jobs already know.
export default function BuildingSector({ label, sectors, firms, uid, userName, onSaved }) {
  const [chosen, setChosen] = useState(sectors || []);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [taught, setTaught] = useState(null);

  const toggle = (sector) =>
    setChosen(prev => (prev.includes(sector) ? prev.filter(s => s !== sector) : [...prev, sector]));

  const save = async () => {
    setSaving(true);
    setError("");
    setTaught(null);
    try {
      await saveBuildingSector({ label, sectors: chosen, uid, userName });
      const updates = await teachFirmsAboutSectors({
        firmNames: firms, sectors: chosen, addressLabel: label, uid, userName
      });
      setTaught(updates);
      setEditing(false);
      if (onSaved) onSaved(chosen);
    } catch (err) {
      setError(err.message || "Couldn't save the sector.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setChosen(sectors || []);
    setEditing(false);
    setError("");
  };

  return (
    <div className="project-section">
      <h4 className="field-label">What sort of building this is</h4>

      {!editing && (
        <>
          {chosen.length === 0
            ? <p className="private-note-hint">No sector set for this building yet.</p>
            : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {chosen.map(s => <span key={s} className="role-badge">{s}</span>)}
              </div>
            )}
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            {chosen.length ? "Change sector" : "Set sector"}
          </button>
        </>
      )}

      {editing && (
        <>
          <p className="private-head-hint settings-hint">
            Pick everything that fits. Saving also records this work for the {firms.length === 1 ? "firm" : "firms"} who
            worked here, so you can find who does this kind of job later.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
            {BUILDING_SECTORS.map(s => (
              <label key={s} className="settings-check" htmlFor={`sector-${s}`} style={{ marginBottom: 0 }}>
                <input
                  id={`sector-${s}`}
                  type="checkbox"
                  checked={chosen.includes(s)}
                  onChange={() => toggle(s)}
                />
                <span>{s}</span>
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={cancel}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save sector"}
            </button>
          </div>
        </>
      )}

      {error && <p className="settings-status is-error">{error}</p>}

      {taught && taught.length > 0 && (
        <p className="settings-status">
          Also recorded on {taught.map(t => `${t.name} (${t.add.join(", ")})`).join("; ")}.
        </p>
      )}
      {taught && taught.length === 0 && chosen.length > 0 && (
        <p className="private-note-hint">Every firm here already had {chosen.length === 1 ? "that sector" : "those sectors"}.</p>
      )}
    </div>
  );
}
