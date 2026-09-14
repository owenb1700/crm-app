"use client";

import { FIRM_TYPES } from "../../lib/directory";

// Picks what kind of firm fills a contractor slot (Contractor or Owner /
// Building Engineer). The company picker next to it narrows its
// suggestions to whichever type is chosen here.
export default function FirmTypeSelect({ id, value, onChange }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>Type</label>
      <select id={id} className="field" value={value} onChange={e => onChange(e.target.value)}>
        {FIRM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}
