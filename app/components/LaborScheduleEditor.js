"use client";

import { useState } from "react";
import {
  rebuildDays, withSameMen, laborDays, totalManDays, peakMen,
  dayLoad, describeDayLoad, describeClashes, crewCapacity, MAX_DAYS
} from "../../lib/laborSchedule";
import { crewNames, peopleOn, peopleForStorage, titleOf } from "../../lib/crew";

// When the work happens and how many men are on it each day.
//
// The same editor on the project's own page and in the scheduling
// calendar's popup, so the two can never drift -- and both write to the
// project itself, which is the only copy there is.
//
// Two things get warned about per day and neither blocks the save: more
// men booked than there are people on the crew list, and one person
// standing on two jobs at once. Both happen on purpose -- jobs get
// booked over and sorted out, and somebody splits a day between two
// sites -- so the warning is there to make it a decision, not a wall.
export default function LaborScheduleEditor({ value, onChange, byDate, projectId, crew = [], idPrefix = "labor" }) {
  const days = laborDays({ laborSchedule: value });
  const includeWeekends = value?.includeWeekends === true;

  // Start and length drive the rows; the rows themselves hold the men.
  const [sameMen, setSameMen] = useState("");
  // What's half-typed in each day's "someone else" box, kept per day so
  // several outside names can be added one after another.
  const [outsideDraft, setOutsideDraft] = useState({});
  const start = days[0]?.date || "";
  const count = days.length;

  const push = (next) => onChange({ includeWeekends, days, ...next });

  const rebuild = ({ newStart = start, newCount = count, weekends = includeWeekends }) => {
    push({
      includeWeekends: weekends,
      days: rebuildDays({
        start: newStart,
        count: newCount,
        includeWeekends: weekends,
        existing: days,
        defaultMen: Number(sameMen) || 0
      })
    });
  };

  const setMenOn = (date, men) =>
    push({ days: days.map(d => (d.date === date ? { ...d, men: Math.max(0, Math.round(Number(men) || 0)) } : d)) });

  const applyToAll = () => push({ days: withSameMen(days, sameMen) });

  // Who's on a given day. The list is the crew an admin keeps, plus a box
  // for anyone who isn't on it -- outside labour gets hired for a week and
  // there's no sense making someone wait on an admin to add them.
  const roster = crewNames(crew);
  // The crew list is the capacity. Hire someone and the number moves.
  const capacity = crewCapacity(crew);
  const setPeopleOn = (date, names) =>
    push({
      days: days.map(d => {
        if (d.date !== date) return d;
        const people = peopleForStorage(names);
        return { ...d, people, men: Math.max(Number(d.men) || 0, people.length) };
      })
    });

  // A day can be taken off without disturbing the rest -- a job that ran
  // Monday to Thursday and lost the Wednesday shouldn't have to be
  // retyped. The rows are the truth; the "how many days" box only ever
  // generates them.
  const addOutsidePerson = (day) => {
    const name = String(outsideDraft[day.date] || "").trim();
    if (!name) return;
    setPeopleOn(day.date, [...peopleOn(day), name]);
    setOutsideDraft(prev => ({ ...prev, [day.date]: "" }));
  };

  const removeDay = (date) => push({ days: days.filter(d => d.date !== date) });
  const clearAllDays = () => push({ days: [] });

  const togglePerson = (day, name) => {
    const on = peopleOn(day);
    setPeopleOn(day.date, on.some(n => n.toLowerCase() === name.toLowerCase())
      ? on.filter(n => n.toLowerCase() !== name.toLowerCase())
      : [...on, name]);
  };

  return (
    <div>
      <div className="form-grid-3">
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-start`}>Work starts</label>
          <input
            id={`${idPrefix}-start`}
            className="field"
            type="date"
            value={start}
            onChange={e => rebuild({ newStart: e.target.value, newCount: count || 1 })}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-count`}>How many days</label>
          <input
            id={`${idPrefix}-count`}
            className="field"
            inputMode="numeric"
            value={count || ""}
            placeholder="—"
            onChange={e => {
              const n = Math.min(MAX_DAYS, Number(e.target.value.replace(/[^\d]/g, "")) || 0);
              rebuild({ newCount: n });
            }}
          />
        </div>
        <div>
          <span className="field-label">Weekends</span>
          <label className="export-notes-toggle" htmlFor={`${idPrefix}-weekends`} style={{ marginBottom: 0 }}>
            <input
              id={`${idPrefix}-weekends`}
              type="checkbox"
              checked={includeWeekends}
              onChange={e => rebuild({ weekends: e.target.checked })}
            />
            <span>
              <strong>Crew works weekends</strong>
              <span className="export-row-desc">Off, the days run Monday to Friday.</span>
            </span>
          </label>
        </div>
      </div>

      {!start ? (
        <p className="private-note-hint">Pick a start date and how many days, then set the men on each one.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
            <label className="field-label" htmlFor={`${idPrefix}-same`} style={{ margin: 0 }}>Same every day</label>
            <input
              id={`${idPrefix}-same`}
              className="field"
              style={{ marginBottom: 0, width: 80 }}
              inputMode="numeric"
              placeholder="men"
              value={sameMen}
              onChange={e => setSameMen(e.target.value.replace(/[^\d]/g, ""))}
            />
            <button type="button" className="btn btn-secondary btn-small" disabled={!sameMen} onClick={applyToAll}>
              Apply to all {days.length} days
            </button>
            <span className="private-note-hint" style={{ margin: 0 }}>or set each day below</span>
          </div>

          <table className="labor-days">
            <tbody>
              {days.map(d => {
                const load = byDate
                  ? dayLoad(byDate, d.date, {
                      excludeProjectId: projectId,
                      adding: d.men,
                      people: peopleOn(d),
                      jobName: "this job",
                      capacity
                    })
                  : null;
                return (
                  <tr key={d.date}>
                    <td className="labor-days-date">
                      <strong>{d.date}</strong>
                      <button
                        type="button"
                        className="crew-chip-remove"
                        aria-label={`Remove ${d.date} from this job`}
                        title="Take this day off the job"
                        onClick={() => removeDay(d.date)}
                      >
                        ✕
                      </button>
                    </td>
                    <td className="labor-days-men">
                      <input
                        className="field"
                        style={{ marginBottom: 0, width: 72 }}
                        inputMode="numeric"
                        aria-label={`Men on ${d.date}`}
                        value={d.men || ""}
                        placeholder="0"
                        onChange={e => setMenOn(d.date, e.target.value.replace(/[^\d]/g, ""))}
                      />
                    </td>
                    <td className="labor-days-who">
                      {load && (
                        <span className="private-note-hint" style={load.over ? { color: "var(--color-warning-strong)" } : undefined}>
                          {load.over ? "⚠ " : ""}{describeDayLoad(load)}
                        </span>
                      )}
                      {/* Being in two places is its own problem: a day can
                          be well under the crew count and still have
                          somebody booked twice. */}
                      {load?.clashes?.length > 0 && (
                        <span className="private-note-hint labor-clash">
                          ⚠ {describeClashes(load.clashes)}
                        </span>
                      )}
                      <div className="crew-pick">
                        {roster.map(name => {
                          const on = peopleOn(d).some(n => n.toLowerCase() === name.toLowerCase());
                          return (
                            <button
                              key={name}
                              type="button"
                              className={`crew-chip ${on ? "crew-chip-on" : ""}`}
                              aria-pressed={on}
                              onClick={() => togglePerson(d, name)}
                              title={titleOf(name, crew) || undefined}
                            >
                              {name}
                              {titleOf(name, crew) && <span className="crew-chip-title">{titleOf(name, crew)}</span>}
                            </button>
                          );
                        })}
                        {peopleOn(d).filter(n => !roster.some(r => r.toLowerCase() === n.toLowerCase())).map(name => (
                          <button
                            key={name}
                            type="button"
                            className="crew-chip crew-chip-on crew-chip-outside"
                            title="Outside labour — not on the crew list"
                            onClick={() => togglePerson(d, name)}
                          >
                            {name}
                          </button>
                        ))}
                        {/* A tick beside the box, so adding somebody is a
                            visible act rather than a guess at whether
                            Enter did anything -- and so a second and third
                            outside name can follow the first. */}
                        <span className="crew-add-wrap">
                          <input
                            className="crew-add"
                            placeholder="+ someone else"
                            aria-label={`Add someone not on the crew list to ${d.date}`}
                            value={outsideDraft[d.date] || ""}
                            onChange={e => setOutsideDraft(prev => ({ ...prev, [d.date]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              addOutsidePerson(d);
                            }}
                          />
                          <button
                            type="button"
                            className="crew-add-go"
                            aria-label={`Add ${outsideDraft[d.date] || "this person"} to ${d.date}`}
                            disabled={!String(outsideDraft[d.date] || "").trim()}
                            onClick={() => addOutsidePerson(d)}
                          >
                            ✓
                          </button>
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {days.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-secondary btn-small" onClick={clearAllDays}>
                Remove all manpower
              </button>
            </div>
          )}

          {days.length > 0 && (
            <p className="private-note-hint" style={{ marginTop: 8 }}>
              {days.length} {days.length === 1 ? "day" : "days"} · {totalManDays({ laborSchedule: value })} man-days · {peakMen({ laborSchedule: value })} at peak.
              {" "}Days with nobody on them aren&apos;t saved.
            </p>
          )}
        </>
      )}
    </div>
  );
}
