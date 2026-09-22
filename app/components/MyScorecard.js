"use client";

import { useState } from "react";
import { summarize, formatMoney, parseMoney } from "../../lib/analytics";
import { splitShares } from "../../lib/splits";

const pct = (n) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);

// A person's own numbers at the top of My Projects. Pipeline entries are
// credited the same way as the Analytics page: the assigned salesperson,
// or whoever created the entry if none was assigned. Project volume is the
// value of every project they own (ongoing and closed). Only ever shows
// the signed-in user's own numbers.

// A shared job counts for someone by their share of it.
const shareOfFor = (uid) => (record, fallbackId) =>
  (splitShares(record, fallbackId).find(s => s.userId === uid)?.weight || 0);

// The Scorecard numbers, as label/value pairs. "year" counts what was
// created since January 1st; "all" counts everything.
function scorecardTiles({ pipelineEntries = [], projects = [], uid, range = "year" }) {
  const shareOf = shareOfFor(uid);
  const mine = pipelineEntries.filter(e => shareOf(e, e.salespersonId || e.ownerId) > 0);
  const myProjects = projects.filter(c => shareOf(c, c.ownerId) > 0);

  const yearStart = `${new Date().getFullYear()}-01-01`;
  const thisRange = (list) => (range === "year" ? list.filter(x => String(x.createdAt || "") >= yearStart) : list);

  // Values are scaled by this person's share; a 60/40 split counts 60% here.
  const s = summarize(thisRange(mine).map(e => ({
    ...e,
    value: (parseMoney(e.value) ?? null) === null ? e.value : parseMoney(e.value) * shareOf(e, e.salespersonId || e.ownerId)
  })));
  const projectVolume = thisRange(myProjects).reduce((sum, c) => sum + (parseMoney(c.projectValue) || 0) * shareOf(c, c.ownerId), 0);

  return [
    { label: "Bid on", value: s.bidOn },
    { label: "Won", value: s.won },
    { label: "Lost", value: s.lost },
    { label: "Win rate", value: pct(s.winRate) },
    { label: "Won volume", value: formatMoney(s.volume.won) },
    { label: "Open volume", value: formatMoney(s.volume.open) },
    { label: "Project volume", value: formatMoney(projectVolume) }
  ];
}

export default function MyScorecard({ pipelineEntries, projects = [], uid }) {
  const [range, setRange] = useState("year"); // "year" | "all"

  const mine = pipelineEntries.filter(e => shareOfFor(uid)(e, e.salespersonId || e.ownerId) > 0);
  const myProjects = projects.filter(c => shareOfFor(uid)(c, c.ownerId) > 0);
  if (mine.length === 0 && myProjects.length === 0) return null;

  const tiles = scorecardTiles({ pipelineEntries, projects, uid, range });

  return (
    <div className="scorecard">
      <div className="scorecard-head">
        <h3 className="analytics-card-title">My Scorecard</h3>
        <div className="scorecard-toggle" role="group" aria-label="Time range">
          <button type="button" className={range === "year" ? "is-active" : ""} aria-pressed={range === "year"} onClick={() => setRange("year")}>
            This year
          </button>
          <button type="button" className={range === "all" ? "is-active" : ""} aria-pressed={range === "all"} onClick={() => setRange("all")}>
            All time
          </button>
        </div>
      </div>
      <div className="scorecard-tiles">
        {tiles.map(t => (
          <div key={t.label} className="scorecard-tile">
            <div className="stat-tile-label">{t.label}</div>
            <div className="scorecard-value">{t.value}</div>
          </div>
        ))}
      </div>
      <p className="private-note-hint" style={{ margin: "8px 0 0" }}>
        Pipeline entries where you're the salesperson (or you created them with no salesperson assigned), plus anything shared with you. Shared jobs count by your share of the split. Win rate counts only won and lost bids.
      </p>
    </div>
  );
}
