"use client";

import { BUILDING_SECTORS } from "../../lib/directory";

export default function BuildingSectorSelect({ id, value, onChange }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>Building Sector (required)</label>
      <select id={id} className="field" value={value || ""} onChange={e => onChange(e.target.value)}>
        <option value="">Select building sector...</option>
        {BUILDING_SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
