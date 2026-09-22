"use client";

import { useEffect, useState } from "react";
import { optionsForCategory, detailsLabel } from "../../lib/newFirms";

// Asked when a form names a firm we know nothing about yet -- a new one,
// or one on file with no type ticked. One firm at a time; whatever is
// picked is saved on the firm itself, so it's asked once and then known
// everywhere.
//
// Tick as many as apply. A contractor that does service and construction
// is one firm, not two.
export default function FirmDetailsPrompt({ queue, busy = false, onDone, onCancel }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    setIndex(0);
    setPicked({});
    setError("");
  }, [queue]);

  const firm = queue?.[index];
  if (!firm) return null;

  const options = optionsForCategory(firm.category);
  const chosen = picked[firm.name] || [];

  const toggle = (tag) => {
    setError("");
    setPicked(prev => {
      const current = prev[firm.name] || [];
      return {
        ...prev,
        [firm.name]: current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag]
      };
    });
  };

  const next = () => {
    if (!chosen.length) return setError("Pick at least one so we know who they are.");
    if (index < queue.length - 1) {
      setIndex(index + 1);
      return;
    }
    onDone(picked);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="firm-details-title">
        <h3 id="firm-details-title" className="modal-title">{firm.name}</h3>
        <p className="modal-subtitle">
          {queue.length > 1 ? `New firm ${index + 1} of ${queue.length}. ` : "This firm is new to the Directory. "}
          {detailsLabel(firm.category)} Address, phone and website can wait — this is what the rest of the site files them under.
        </p>

        <div className="firm-tag-picker">
          {options.map(tag => (
            <label key={tag} className="settings-check" htmlFor={`firm-details-${tag}`}>
              <input
                id={`firm-details-${tag}`}
                type="checkbox"
                checked={chosen.includes(tag)}
                onChange={() => toggle(tag)}
              />
              <span>{tag}</span>
            </label>
          ))}
        </div>

        {error && <p className="settings-status is-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={next}>
            {busy ? "Saving…" : (index < queue.length - 1 ? "Next firm" : "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
