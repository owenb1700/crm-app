"use client";

import { useState } from "react";
import { CONTRACTOR_WORK_TYPES } from "../../lib/directory";

// Asked when a parts request names a contractor we don't know the type of
// -- a new firm, or one on file with nothing ticked. Saving records it on
// the firm in the Directory, so it's asked once and then known everywhere.
export default function ContractorTypePrompt({ firmName, busy = false, onChoose, onCancel }) {
  const [type, setType] = useState(CONTRACTOR_WORK_TYPES[0]);

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">What kind of contractor is {firmName}?</h3>
        <p className="modal-subtitle">
          We don&apos;t have a type on file for them. This is saved on the firm, so it&apos;s only asked once — more can be
          ticked later on their Directory page.
        </p>

        <label className="field-label" htmlFor="contractor-type">Type</label>
        <select id="contractor-type" className="field" value={type} onChange={e => setType(e.target.value)}>
          {CONTRACTOR_WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <div className="modal-actions">
          <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => onChoose(type)}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
