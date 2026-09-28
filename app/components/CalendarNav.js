"use client";

import { dateKey, startOfWeek, shiftWeeks } from "../../lib/calendarDays";
import ShortDateInput from "./ShortDateInput";

// Stepping a four-week calendar back and forward, on Home and on Project
// Scheduling. A week at a time with the arrows, or straight to a date by
// typing one -- the calendar lands on the four weeks starting with that
// date's Monday.
//
// "Today" only appears once you've moved away, so it's a way back rather
// than a permanent button doing nothing.
//
// The date box is ShortDateInput rather than <input type="date">, because
// a native date input renders its year from the browser's locale and
// can't be told to show two digits. It still has the calendar popup.

export default function CalendarNav({ anchor, onAnchor, idPrefix = "cal" }) {
  const today = new Date();

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

      <span className="calendar-nav-jump">
        <span className="private-note-hint">Jump to</span>
        <ShortDateInput
          idPrefix={`${idPrefix}-jump`}
          value={first}
          onPick={onAnchor}
        />
      </span>

      {!onThisWeek && (
        <button type="button" className="btn btn-secondary btn-small" onClick={() => onAnchor(new Date())}>
          Today
        </button>
      )}
    </div>
  );
}
