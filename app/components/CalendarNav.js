"use client";

import { useEffect, useRef, useState } from "react";
import { dateKey, startOfWeek, shiftWeeks, dateFromKey } from "../../lib/calendarDays";

// Stepping a four-week calendar back and forward, on Home and on Project
// Scheduling. A week at a time with the arrows, or straight to a date by
// typing one -- the calendar lands on the four weeks starting with that
// date's Monday.
//
// "Today" only appears once you've moved away, so it's a way back rather
// than a permanent button doing nothing.
export default function CalendarNav({ anchor, onAnchor, idPrefix = "cal" }) {
  const today = new Date();

  // The typed date is held here rather than read back off the anchor.
  // Binding the box straight to the anchor rewrote it to that week's
  // Monday the instant a date was complete, so the next keystroke was
  // editing a date nobody typed -- which made two-digit months and days
  // nearly impossible to enter.
  const [typed, setTyped] = useState(() => dateKey(startOfWeek(anchor)));
  const fromTyping = useRef(false);

  useEffect(() => {
    // Arrows and Today should move the box; typing shouldn't fight itself.
    if (fromTyping.current) {
      fromTyping.current = false;
      return;
    }
    setTyped(dateKey(startOfWeek(anchor)));
  }, [anchor]);
  const onThisWeek = dateKey(startOfWeek(anchor)) === dateKey(startOfWeek(today));

  const first = startOfWeek(anchor);
  const last = shiftWeeks(first, 4);
  last.setDate(last.getDate() - 1);

  const span = `${first.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${last.toLocaleDateString(undefined, { month: "short", day: "numeric", year: first.getFullYear() === last.getFullYear() ? undefined : "numeric" })}`;

  return (
    <div className="calendar-nav">
      <button
        type="button"
        className="btn btn-secondary btn-small"
        aria-label="Previous week"
        onClick={() => onAnchor(shiftWeeks(anchor, -1))}
      >
        ‹
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-small"
        aria-label="Next week"
        onClick={() => onAnchor(shiftWeeks(anchor, 1))}
      >
        ›
      </button>

      <span className="calendar-nav-span">{span}</span>

      <label className="calendar-nav-jump" htmlFor={`${idPrefix}-jump`}>
        <span className="private-note-hint">Jump to</span>
        <input
          id={`${idPrefix}-jump`}
          className="field"
          type="date"
          style={{ marginBottom: 0 }}
          value={typed}
          onChange={e => {
            const value = e.target.value;
            setTyped(value);
            // A native date input reports "" until every part is filled,
            // so a half-typed date simply doesn't move the calendar.
            const picked = dateFromKey(value);
            if (picked) {
              fromTyping.current = true;
              onAnchor(picked);
            }
          }}
        />
      </label>

      {!onThisWeek && (
        <button type="button" className="btn btn-secondary btn-small" onClick={() => onAnchor(new Date())}>
          Today
        </button>
      )}
    </div>
  );
}
