"use client";

import { useEffect, useRef, useState } from "react";
import { dateFromSegments } from "../../lib/calendarDays";

// A date box that behaves like the browser's own -- three segments you
// tab and type straight through, arrow keys to nudge a number, backspace
// to fall back into the segment before -- but showing a two-digit year,
// which <input type="date"> can't be told to do.
//
// It reports a date only once all three segments are filled and the date
// is real, so a half-typed date never moves anything.
//
// The calendar popup is still there: a button opens a real date input's
// own picker, kept off-screen purely so its four-digit year never shows.

const pad2 = (n) => String(n).padStart(2, "0");
const digitsOnly = (v) => String(v || "").replace(/\D/g, "").slice(0, 2);

const LIMITS = { month: [1, 12], day: [1, 31], year: [0, 99] };

export default function ShortDateInput({ idPrefix, value, onPick, ariaLabel = "Jump to date" }) {
  const [month, setMonth] = useState(() => pad2(value.getMonth() + 1));
  const [day, setDay] = useState(() => pad2(value.getDate()));
  const [year, setYear] = useState(() => String(value.getFullYear()).slice(-2));

  const pickerRef = useRef(null);
  const monthRef = useRef(null);
  const dayRef = useRef(null);
  const yearRef = useRef(null);
  const fromTyping = useRef(false);

  // The arrows and Today move the box; typing shouldn't fight itself.
  //
  // Keyed on the time value, not the Date object: the parent builds a new
  // Date every render, so depending on the object itself re-ran this on
  // every keystroke and wiped whatever had just been typed.
  const valueTime = value.getTime();
  useEffect(() => {
    if (fromTyping.current) {
      fromTyping.current = false;
      return;
    }
    const d = new Date(valueTime);
    setMonth(pad2(d.getMonth() + 1));
    setDay(pad2(d.getDate()));
    setYear(String(d.getFullYear()).slice(-2));
  }, [valueTime]);

  const report = (next) => {
    const picked = dateFromSegments(next);
    if (picked) {
      fromTyping.current = true;
      onPick(picked);
    }
  };

  const change = (which, raw, nextRef) => {
    const v = digitsOnly(raw);
    const next = { month, day, year, [which]: v };
    if (which === "month") setMonth(v);
    if (which === "day") setDay(v);
    if (which === "year") setYear(v);
    // Straight on to the next segment once this one is full, same as the
    // native control.
    if (v.length === 2 && nextRef?.current) nextRef.current.focus();
    report(next);
  };

  const onKeyDown = (which, v, prevRef) => (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const [lo, hi] = LIMITS[which];
      const step = e.key === "ArrowUp" ? 1 : -1;
      const current = v === "" ? lo : Number(v);
      const wrapped = current + step > hi ? lo : current + step < lo ? hi : current + step;
      const set = pad2(wrapped);
      const next = { month, day, year, [which]: set };
      if (which === "month") setMonth(set);
      if (which === "day") setDay(set);
      if (which === "year") setYear(set);
      report(next);
      return;
    }
    // Backspace on an empty segment steps back, the way the native one does.
    if (e.key === "Backspace" && v === "" && prevRef?.current) {
      e.preventDefault();
      prevRef.current.focus();
    }
  };

  // Anything left half-typed snaps back to where the calendar actually is,
  // rather than sitting there looking as though it were accepted.
  //
  // This has to be on the group, not on each segment: auto-advance moves
  // focus from month to day, which blurs the month, and resetting there
  // wiped the digits that had just been typed.
  const onGroupBlur = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return; // still inside
    if (dateFromSegments({ month, day, year })) return;
    setMonth(pad2(value.getMonth() + 1));
    setDay(pad2(value.getDate()));
    setYear(String(value.getFullYear()).slice(-2));
  };

  const seg = (id, ref, v, which, nextRef, prevRef, placeholder, label, width) => (
    <input
      id={id}
      ref={ref}
      className="short-date-seg"
      style={{ width }}
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      aria-label={label}
      maxLength={2}
      value={v}
      onFocus={e => e.target.select()}
      onChange={e => change(which, e.target.value, nextRef)}
      onKeyDown={onKeyDown(which, v, prevRef)}
    />
  );

  const isoValue = `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    // showPicker is the supported way to open it; older browsers get a
    // plain focus, which at least puts the control in reach.
    if (typeof el.showPicker === "function") el.showPicker();
    else el.focus();
  };

  return (
    <span className="short-date" role="group" aria-label={ariaLabel} onBlur={onGroupBlur}>
      {seg(`${idPrefix}-mm`, monthRef, month, "month", dayRef, null, "mm", "Month", 26)}
      <span className="short-date-sep">/</span>
      {seg(`${idPrefix}-dd`, dayRef, day, "day", yearRef, monthRef, "dd", "Day", 26)}
      <span className="short-date-sep">/</span>
      {seg(`${idPrefix}-yy`, yearRef, year, "year", null, dayRef, "yy", "Year", 26)}

      <button
        type="button"
        className="short-date-picker-btn"
        aria-label="Open calendar"
        title="Pick from a calendar"
        onClick={openPicker}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="1.7" y="3" width="12.6" height="11.3" rx="1.6" />
          <path d="M1.7 6.6h12.6" />
          <path d="M5.3 1.7v2.4M10.7 1.7v2.4" strokeLinecap="round" />
        </svg>
      </button>
      <input
        ref={pickerRef}
        type="date"
        className="short-date-picker"
        tabIndex={-1}
        aria-hidden="true"
        value={isoValue}
        onChange={e => {
          const [y, m, d] = e.target.value.split("-").map(Number);
          if (!y || !m || !d) return;
          setMonth(pad2(m));
          setDay(pad2(d));
          setYear(String(y).slice(-2));
          fromTyping.current = true;
          onPick(new Date(y, m - 1, d));
        }}
      />
    </span>
  );
}
