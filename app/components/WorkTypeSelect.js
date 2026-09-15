"use client";

import { WORK_TYPES } from "../../lib/directory";

// New Installation or Repair -- required on every project and pipeline entry.
export default function WorkTypeSelect({ id, value, onChange }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>Work Type (required)</label>
      <select id={id} className="field" value={value || ""} onChange={e => onChange(e.target.value)}>
        <option value="">New installation or repair...</option>
        {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}
