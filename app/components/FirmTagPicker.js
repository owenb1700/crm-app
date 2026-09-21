"use client";

import { firmTagOptions, firmTagLabel } from "../../lib/directory";

// What a firm is known for: a contractor does Service, Construction, or
// both; an owner's buildings are Healthcare, Office, and so on. Tick as
// many as apply -- these are what the Directory filters on.
export default function FirmTagPicker({ idPrefix, category, value = [], onChange }) {
  const options = firmTagOptions(category);
  const selected = Array.isArray(value) ? value : [];

  const toggle = (tag) =>
    onChange(selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag]);

  return (
    <div>
      <h4 className="field-label">{firmTagLabel(category)}</h4>
      <div className="firm-tag-picker">
        {options.map(tag => (
          <label key={tag} className="settings-check" htmlFor={`${idPrefix}-${tag}`}>
            <input
              id={`${idPrefix}-${tag}`}
              type="checkbox"
              checked={selected.includes(tag)}
              onChange={() => toggle(tag)}
            />
            <span>{tag}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
