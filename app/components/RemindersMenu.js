"use client";

import { useEffect, useRef, useState } from "react";

// The Reminders button beside the header search: add one right here, or
// open the page with all of them.
export default function RemindersMenu({ onAdd, onSeeAll }) {
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

  const choose = (action) => {
    setOpen(false);
    action();
  };

  return (
    <div className="reminders-menu" ref={boxRef}>
      <button type="button" className="btn btn-primary" aria-expanded={open} onClick={() => setOpen(!open)}>
        Reminders ▾
      </button>
      {open && (
        <div className="tab-dropdown-menu-card reminders-menu-card">
          <a className="tab-dropdown-item" onClick={() => choose(onAdd)}>+ Add reminder</a>
          <a className="tab-dropdown-item" onClick={() => choose(onSeeAll)}>See all reminders</a>
        </div>
      )}
    </div>
  );
}
