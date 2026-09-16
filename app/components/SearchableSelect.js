"use client";

import { useEffect, useRef, useState } from "react";

// A text field that doubles as a searchable dropdown: typing filters the
// option list live, clicking an option selects it, and typing something
// that doesn't match anything shows a "+ Enter '<text>' as a new X" row so
// the value can still be committed as a brand-new entry. The list closes on
// a press outside it, not on the input's blur, so a tap on an option isn't
// lost on touchscreens (where blur lands first).
export default function SearchableSelect({ options, value, onChange, placeholder, newLabel = "contractor" }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPressOutside = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPressOutside);
    return () => document.removeEventListener("pointerdown", onPressOutside);
  });

  const query = (value || "").trim().toLowerCase();
  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query))
    : options;
  const exactMatch = options.some(o => o.toLowerCase() === query);
  const showCreateRow = query.length > 0 && !exactMatch;

  return (
    <div style={{ position: "relative" }} ref={boxRef}>
      <input
        className="field"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === "Escape" || e.key === "Enter") setOpen(false); }}
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
              onPointerDown={e => { e.preventDefault(); onChange(o); setOpen(false); }}
            >
              {o}
            </div>
          ))}
          {showCreateRow && (
            <div
              className="tab-dropdown-item"
              onPointerDown={e => { e.preventDefault(); onChange(value); setOpen(false); }}
            >
              + Enter "{value}" as a new {newLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
