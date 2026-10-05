"use client";

import { useState } from "react";

// Who to tell about a note, between pressing Add note and the note being
// saved.
//
// Pressing Add note unfolds this; the note isn't written until Add note is
// pressed again. Telling nobody is a choice you make rather than one that
// happens by default, so the button stays disabled until either somebody
// is ticked or "Alert no one" is. The point is that a note is never
// written without its author having decided who should hear about it.
//
// Private notes never come through here. There is nobody to tell about a
// note only you can read.
export default function NoteAlertPicker({ people, busy, onCancel, onAdd }) {
  const [picked, setPicked] = useState([]);
  const [tellNobody, setTellNobody] = useState(false);

  const everyone = people.length > 0 && picked.length === people.length;
  const decided = tellNobody || picked.length > 0;

  const toggle = (id) => {
    setTellNobody(false);
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const toggleEveryone = () => {
    setTellNobody(false);
    setPicked(everyone ? [] : people.map(p => p.id));
  };

  const chooseNobody = () => {
    setPicked([]);
    setTellNobody(true);
  };

  return (
    <div className="note-alert-picker">
      <span className="field-label" style={{ marginTop: 0 }}>Who should know?</span>

      {people.length === 0 ? (
        <p className="private-note-hint">
          Nobody else is on this job yet, so there is no one to tell. The note still gets added.
        </p>
      ) : (
        <>
          <label className="settings-check" htmlFor="note-alert-everyone">
            <input id="note-alert-everyone" type="checkbox" checked={everyone} onChange={toggleEveryone} />
            <span><strong>Everyone on this job</strong></span>
          </label>

          {people.map(p => (
            <label key={p.id} className="settings-check" htmlFor={`note-alert-${p.id}`}>
              <input
                id={`note-alert-${p.id}`}
                type="checkbox"
                checked={picked.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              <span>
                {p.name}
                <span className="private-note-hint" style={{ margin: "0 0 0 6px" }}>{p.why}</span>
              </span>
            </label>
          ))}
        </>
      )}

      <label className="settings-check" htmlFor="note-alert-nobody" style={{ marginTop: 6 }}>
        <input id="note-alert-nobody" type="checkbox" checked={tellNobody} onChange={chooseNobody} />
        <span>Alert no one</span>
      </label>

      <div className="modal-actions" style={{ marginTop: 10 }}>
        <button
          className="btn btn-primary"
          disabled={busy || (!decided && people.length > 0)}
          onClick={() => onAdd(tellNobody ? [] : picked)}
        >
          {busy ? "Saving…" : "Add note"}
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
