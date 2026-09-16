"use client";

import { useEffect, useRef, useState } from "react";

// A type-to-search field for Directory names (firms and people) that
// steers people toward what's already on file instead of creating a
// near-duplicate:
// - A name that's the same as an existing one apart from punctuation,
//   spacing, or Inc/LLC ("abc mechanical inc") snaps to the existing
//   spelling when the field is left.
// - A name that's merely similar ("ABC Mechnical") gets a "Did you mean…?"
//   under the field, and similar names are listed above the "+ Add new" row.
// `options` are strings or { value, tag } (tag = a small label, e.g. the
// firm's Directory category). `isSame` / `isSimilar` compare two names.
export default function MatchingSelect({ id, options, value, onChange, placeholder, newLabel = "entry", isSame, isSimilar }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const boxRef = useRef(null);

  const list = (options || []).map(o => (typeof o === "string" ? { value: o } : o)).filter(o => o.value);
  const text = value || "";
  const query = text.trim().toLowerCase();

  const same = query ? list.find(o => isSame(o.value, text)) : null;
  const similar = query && !same ? list.filter(o => isSimilar(o.value, text)).slice(0, 3) : [];
  const filtered = query
    ? list.filter(o => o.value.toLowerCase().includes(query) && o !== same && !similar.includes(o))
    : list;
  const exactValue = same && same.value === text;

  const pick = (v) => {
    onChange(v);
    setOpen(false);
  };

  // Closing on the field's own blur would race a tap on the list: on a phone
  // or iPad the blur fires first and the option is gone before the tap lands.
  // The list closes on a press outside it instead, and that's also when a
  // spelling of a name already on file snaps to the existing one.
  useEffect(() => {
    if (!open) return undefined;
    const onPressOutside = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      setOpen(false);
      if (same && same.value !== text) onChange(same.value);
    };
    document.addEventListener("pointerdown", onPressOutside);
    return () => document.removeEventListener("pointerdown", onPressOutside);
  });

  const showSame = same && !exactValue;
  const showCreate = query && !same;
  const hasRows = showSame || similar.length > 0 || filtered.length > 0 || showCreate;

  const tagOf = (o) => (o.tag ? <span className="matching-select-tag">{o.tag}</span> : null);
  const showSuggestion = !open && query && !same && similar.length > 0 && dismissed !== text;

  return (
    <div className="matching-select" ref={boxRef}>
      <input
        id={id}
        className="field"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            setOpen(false);
            if (same && same.value !== text) onChange(same.value);
          }
        }}
      />

      {open && hasRows && (
        <div className="tab-dropdown-menu-card matching-select-menu" role="listbox">
          {showSame && (
            <div className="tab-dropdown-item matching-select-same" role="option" aria-selected="false" onPointerDown={e => { e.preventDefault(); pick(same.value); }}>
              Use <strong>{same.value}</strong> (already in the Directory) {tagOf(same)}
            </div>
          )}
          {similar.length > 0 && (
            <>
              <div className="matching-select-heading">Similar in the Directory</div>
              {similar.map(o => (
                <div key={`s-${o.value}`} className="tab-dropdown-item" role="option" aria-selected="false" onPointerDown={e => { e.preventDefault(); pick(o.value); }}>
                  {o.value} {tagOf(o)}
                </div>
              ))}
            </>
          )}
          {filtered.slice(0, 60).map(o => (
            <div key={o.value} className="tab-dropdown-item" role="option" aria-selected={o.value === text} onPointerDown={e => { e.preventDefault(); pick(o.value); }}>
              {o.value} {tagOf(o)}
            </div>
          ))}
          {showCreate && (
            <div className="tab-dropdown-item matching-select-new" role="option" aria-selected="false" onPointerDown={e => { e.preventDefault(); setDismissed(text); pick(text); }}>
              + Add &quot;{text.trim()}&quot; as a new {newLabel}
            </div>
          )}
        </div>
      )}

      {showSuggestion && (
        <p className="matching-select-suggest">
          Did you mean{" "}
          {similar.map((o, i) => (
            <span key={o.value}>
              {i > 0 && " or "}
              <button type="button" className="link-muted matching-select-link" onClick={() => onChange(o.value)}>{o.value}</button>
            </span>
          ))}
          ?{" "}
          <button type="button" className="matching-select-link matching-select-dismiss" onClick={() => setDismissed(text)}>No, it&apos;s new</button>
        </p>
      )}
    </div>
  );
}
