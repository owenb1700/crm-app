"use client";

import { useState } from "react";

// A text field that doubles as a searchable dropdown: typing filters the
// option list live, clicking an option selects it, and typing something
// that doesn't match anything shows a "+ Enter '<text>' as a new X" row so
// the value can still be committed as a brand-new entry. Options close via
// onMouseDown (fires before the input's onBlur) so a click always registers.
export default function SearchableSelect({ options, value, onChange, placeholder, newLabel = "contractor" }) {
  const [open, setOpen] = useState(false);

  const query = (value || "").trim().toLowerCase();
  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query))
    : options;
  const exactMatch = options.some(o => o.toLowerCase() === query);
  const showCreateRow = query.length > 0 && !exactMatch;

  return (
    <div style={{ position: "relative" }}>
      <input
        className="field"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && (filtered.length > 0 || showCreateRow) && (
        <div
          className="tab-dropdown-menu-card"
          style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, maxHeight: 240, overflowY: "auto", zIndex: 20 }}
        >
          {filtered.map(o => (
            <div
              key={o}
              className="tab-dropdown-item"
              onMouseDown={() => onChange(o)}
            >
              {o}
            </div>
          ))}
          {showCreateRow && (
            <div
              className="tab-dropdown-item"
              onMouseDown={() => onChange(value)}
            >
              + Enter "{value}" as a new {newLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
