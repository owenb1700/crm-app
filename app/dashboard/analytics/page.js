"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../../../lib/firebase";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { BUILDING_SECTORS, WORK_TYPES } from "../../../lib/directory";
import { canViewAnalytics, summarize, summarizeProjects, combinedBreakdown, breakdown, breakdownMulti, manufacturersOf, bidForecast, outcomesByMonth, formatMoney, parseMoney, statusOf } from "../../../lib/analytics";
import { downloadTable, csvDateStamp } from "../../../lib/csv";
import ExportButtons from "../../components/ExportButtons";
import DashboardHeader from "../../components/DashboardHeader";
import FilterBar, { matchesDateFilter, optionsFrom, isFilterActive } from "../../components/FilterBar";
import ExportDataModal from "../../components/ExportDataModal";
import MobileNav from "../../components/MobileNav";
import { withoutTrashed } from "../../../lib/trash";

const SESSION_LENGTH_MS = 10 * 60 * 60 * 1000;
const clearSession = () => localStorage.removeItem("loginTimestamp");

// Won / Lost / Did Not Bid are identities, not good/bad status, so they take
// the first three categorical slots (validated as a set on this surface).
const SERIES = [
  { key: "won", label: "Won", color: "#2a78d6" },
  { key: "lost", label: "Lost", color: "#eb6834" },
  { key: "dnb", label: "Did Not Bid", color: "#1baf7a" }
];

const pct = (n) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);
const STATUS_LABEL = { won: "Won", lost: "Lost", dnb: "Did Not Bid", open: "Open" };

// Exports use raw numbers (whole dollars, win rate as a percent) so they
// sort and sum correctly in a spreadsheet.
const exportBreakdown = (filename, nameHeader, rows, format) => downloadTable({
  format,
  filename: `${filename}-${csvDateStamp()}`,
  headers: [nameHeader, "Entries", "Won", "Lost", "Did Not Bid", "Open", "Win rate %", "Won volume", "Lost volume", "Open volume", "Total volume"],
  rows: rows.map(r => [
    r.label || r.key, r.total, r.won, r.lost, r.dnb, r.open,
    r.winRate === null ? "" : Math.round(r.winRate * 1000) / 10,
    Math.round(r.volume.won), Math.round(r.volume.lost), Math.round(r.volume.open), Math.round(r.volume.total)
  ])
});

function StatTile({ label, value, sub }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">{value}</div>
      {sub && <div className="stat-tile-sub">{sub}</div>}
    </div>
  );
}

function OutcomesChart({ buckets }) {
  const [hover, setHover] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(1, ...buckets.map(b => b.won + b.lost + b.dnb));
  const niceMax = Math.max(4, Math.ceil(max / 4) * 4);
  const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];
  const total = buckets.reduce((sum, b) => sum + b.won + b.lost + b.dnb, 0);

  return (
    <div className="analytics-card">
      <div className="analytics-card-head">
        <div>
          <h3 className="analytics-card-title">Outcomes by month</h3>
          <p className="analytics-card-sub">Pipeline entries resolved in each of the last 12 months</p>
        </div>
        <div className="chart-legend" aria-label="Legend">
          {SERIES.map(s => (
            <span key={s.key} className="chart-legend-item">
              <span className="chart-legend-swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="private-note-hint">Nothing was resolved in the last 12 months for these filters.</p>
      ) : (
        <div className="bar-chart" role="img" aria-label={`Won, lost, and did-not-bid counts for each of the last 12 months, ${total} total`}>
          <div className="bar-chart-axis">
            {[...ticks].reverse().map(t => <span key={t}>{t}</span>)}
          </div>
          <div className="bar-chart-plot">
            <div className="bar-chart-grid" aria-hidden="true">
              {ticks.map(t => (
                <div key={t} className="bar-chart-gridline" style={{ bottom: `${(t / niceMax) * 100}%` }} />
              ))}
            </div>
            <div className="bar-chart-columns">
              {buckets.map((b, i) => {
                const count = b.won + b.lost + b.dnb;
                return (
                  <div
                    key={b.key}
                    className="bar-chart-column"
                    tabIndex={0}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  >
                    <div className="bar-chart-bar-area">
                      <div className="bar-chart-stack" style={{ height: `${(count / niceMax) * 100}%` }}>
                        {/* Stacked bottom-up: Won, Lost, Did Not Bid */}
                        {SERIES.map(s => b[s.key] > 0 && (
                          <div key={s.key} className="bar-chart-segment" style={{ flexGrow: b[s.key], background: s.color }} />
                        )).reverse()}
                      </div>
                    </div>
                    <div className={`bar-chart-label ${i === buckets.length - 1 || b.label === "Jan" ? "is-strong" : ""}`}>
                      {b.label}{b.label === "Jan" ? ` ’${String(b.year).slice(2)}` : ""}
                    </div>

                    {hover === i && (
                      <div className={`chart-tooltip ${i > buckets.length - 4 ? "is-left" : ""}`}>
                        <div className="chart-tooltip-title">
                          {new Date(b.year, Number(b.key.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                        </div>
                        {SERIES.map(s => (
                          <div key={s.key} className="chart-tooltip-row">
                            <span className="chart-tooltip-key" style={{ background: s.color }} />
                            <strong>{b[s.key]}</strong>
                            <span>{s.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="settings-link" onClick={() => setShowTable(v => !v)}>
          {showTable ? "Hide table" : "Show as table"}
        </button>
        <ExportButtons label="outcomes by month" onExport={(format) => downloadTable({
          format,
          filename: `outcomes-by-month-${csvDateStamp()}`,
          headers: ["Month", "Won", "Lost", "Did Not Bid"],
          rows: buckets.map(b => [b.key, b.won, b.lost, b.dnb])
        })} />
      </div>
      {showTable && (
        <div className="analytics-table-wrap" style={{ marginTop: 8 }}>
          <table className="analytics-table stack-on-phone">
            <thead>
              <tr><th>Month</th><th>Won</th><th>Lost</th><th>Did Not Bid</th></tr>
            </thead>
            <tbody>
              {buckets.map(b => (
                <tr key={b.key}>
                  <td data-label="Month">{new Date(b.year, Number(b.key.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</td>
                  <td data-label="Won">{b.won}</td><td data-label="Lost">{b.lost}</td><td data-label="Did Not Bid">{b.dnb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Pipeline and projects side by side for one grouping (work type, person).
function CombinedTable({ title, sub, rows, nameHeader, filename }) {
  const exportRows = (format) => downloadTable({
    format,
    filename: `${filename}-${csvDateStamp()}`,
    headers: [nameHeader, "Pipeline entries", "Won", "Lost", "Win rate %", "Won volume", "Open volume", "Projects", "Ongoing", "Closed", "Project volume"],
    rows: rows.map(r => [
      r.label || r.key, r.pipeline.total, r.pipeline.won, r.pipeline.lost,
      r.pipeline.winRate === null ? "" : Math.round(r.pipeline.winRate * 1000) / 10,
      Math.round(r.pipeline.volume.won), Math.round(r.pipeline.volume.open),
      r.projects.count, r.projects.ongoing, r.projects.closed, Math.round(r.projects.volume)
    ])
  });

  return (
    <div className="analytics-card">
      <div className="analytics-card-head" style={{ marginBottom: 0 }}>
        <div>
          <h3 className="analytics-card-title">{title}</h3>
          {sub && <p className="analytics-card-sub">{sub}</p>}
        </div>
        {rows.length > 0 && <ExportButtons label={title} onExport={exportRows} />}
      </div>
      {rows.length === 0 ? (
        <p className="private-note-hint">Nothing matches these filters.</p>
      ) : (
        <div className="analytics-table-wrap">
          <table className="analytics-table stack-on-phone">
            <thead>
              <tr>
                <th>{nameHeader}</th>
                <th>Pipeline</th>
                <th>Won</th>
                <th>Lost</th>
                <th>Win rate</th>
                <th>Won volume</th>
                <th>Projects</th>
                <th>Ongoing</th>
                <th>Project volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="analytics-table-name" data-label={nameHeader}>{r.label || r.key}</td>
                  <td data-label="Pipeline">{r.pipeline.total}</td>
                  <td data-label="Won">{r.pipeline.won}</td>
                  <td data-label="Lost">{r.pipeline.lost}</td>
                  <td data-label="Win rate">
                    <div className="win-rate-cell">
                      <span>{pct(r.pipeline.winRate)}</span>
                      {r.pipeline.winRate !== null && (
                        <span className="win-rate-track" aria-hidden="true">
                          <span className="win-rate-fill" style={{ width: `${r.pipeline.winRate * 100}%` }} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td data-label="Won volume">{formatMoney(r.pipeline.volume.won)}</td>
                  <td data-label="Projects">{r.projects.count}</td>
                  <td data-label="Ongoing">{r.projects.ongoing}</td>
                  <td data-label="Project volume">{formatMoney(r.projects.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BreakdownTable({ title, sub, rows, nameHeader, filename }) {
  return (
    <div className="analytics-card">
      <div className="analytics-card-head" style={{ marginBottom: 0 }}>
        <div>
          <h3 className="analytics-card-title">{title}</h3>
          {sub && <p className="analytics-card-sub">{sub}</p>}
        </div>
        {rows.length > 0 && <ExportButtons label={title} onExport={(format) => exportBreakdown(filename, nameHeader, rows, format)} />}
      </div>
      {rows.length === 0 ? (
        <p className="private-note-hint">No entries match these filters.</p>
      ) : (
        <div className="analytics-table-wrap">
          <table className="analytics-table stack-on-phone">
            <thead>
              <tr>
                <th>{nameHeader}</th>
                <th>Entries</th>
                <th>Won</th>
                <th>Lost</th>
                <th>Did Not Bid</th>
                <th>Open</th>
                <th>Win rate</th>
                <th>Won volume</th>
                <th>Total volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="analytics-table-name" data-label={nameHeader}>{r.label || r.key}</td>
                  <td data-label="Entries">{r.total}</td>
                  <td data-label="Won">{r.won}</td>
                  <td data-label="Lost">{r.lost}</td>
                  <td data-label="Did Not Bid">{r.dnb}</td>
                  <td data-label="Open">{r.open}</td>
                  <td data-label="Win rate">
                    <div className="win-rate-cell">
                      <span>{pct(r.winRate)}</span>
                      {r.winRate !== null && (
                        <span className="win-rate-track" aria-hidden="true">
                          <span className="win-rate-fill" style={{ width: `${r.winRate * 100}%` }} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td data-label="Won volume">{formatMoney(r.volume.won)}</td>
                  <td data-label="Total volume">{formatMoney(r.volume.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [uid, setUid] = useState(null);
  const [allowed, setAllowed] = useState(null); // null = checking
  const [myProfile, setMyProfile] = useState(null);
  const [exportPersonId, setExportPersonId] = useState("");
  const [exportTarget, setExportTarget] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({});

  useEffect(() => {
    let timer;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const loginTimestamp = Number(localStorage.getItem("loginTimestamp") || 0);
      const elapsed = Date.now() - loginTimestamp;
      if (!user || !loginTimestamp || elapsed > SESSION_LENGTH_MS) {
        clearSession();
        signOut(auth);
        router.push("/");
        return;
      }
      timer = setTimeout(() => {
        clearSession();
        signOut(auth);
        router.push("/");
      }, SESSION_LENGTH_MS - elapsed);

      setUid(user.uid);
      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        if (!profileSnap.exists()) {
          router.push("/dashboard");
          return;
        }
        const profile = profileSnap.data();
        if (profile.disabled) {
          clearSession();
          await signOut(auth);
          router.push("/");
          return;
        }
        if (!canViewAnalytics(profile)) {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        setMyProfile(profile);

        const [pipelineSnap, customersSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, "pipeline")),
          getDocs(collection(db, "customers")),
          getDocs(collection(db, "users"))
        ]);
        setEntries(withoutTrashed(pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setProjects(withoutTrashed(customersSnap.docs.map(d => ({ id: d.id, ...d.data() }))));
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      } catch (err) {
        setLoadError(err.message || "Something went wrong loading analytics.");
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const personLabel = (id) => {
    const u = users.find(x => x.id === id);
    if (!u) return "Unknown";
    return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
  };
  // Credit goes to the assigned salesperson; entries without one fall back
  // to whoever created them.
  const salespersonOf = (e) => e.salespersonId || e.ownerId;

  // A project is credited to its owner (the salesperson it was assigned to).
  const projectSalespersonOf = (p) => p.ownerId;

  const filtered = useMemo(() => (filters.show === "projects" ? [] : entries)
    .filter(e => !filters.sector || e.buildingSector === filters.sector)
    .filter(e => !filters.workType || e.workType === filters.workType)
    .filter(e => !filters.person || salespersonOf(e) === filters.person)
    .filter(e => !filters.stage || e.stage === filters.stage)
    .filter(e => matchesDateFilter(e.createdAt, filters.created)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [entries, filters]);

  // Stage is a pipeline-only idea, so picking one leaves projects out.
  const filteredProjects = useMemo(() => (filters.show === "pipeline" || filters.stage ? [] : projects)
    .filter(p => !filters.sector || p.buildingSector === filters.sector)
    .filter(p => !filters.workType || p.workType === filters.workType)
    .filter(p => !filters.person || projectSalespersonOf(p) === filters.person)
    .filter(p => !filters.status || p.category === filters.status)
    .filter(p => matchesDateFilter(p.createdAt, filters.created)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [projects, filters]);

  const projectStats = useMemo(() => summarizeProjects(filteredProjects), [filteredProjects]);

  const stats = useMemo(() => summarize(filtered), [filtered]);
  const months = useMemo(() => outcomesByMonth(filtered), [filtered]);
  const bySector = useMemo(() => breakdown(filtered, e => e.buildingSector), [filtered]);
  const byFirm = useMemo(() => breakdown(filtered, e => e.company), [filtered]);
  const byManufacturer = useMemo(() => breakdownMulti(filtered, manufacturersOf), [filtered]);
  const forecast = useMemo(() => bidForecast(filtered), [filtered]);
  const byPerson = useMemo(
    () => combinedBreakdown({
      entries: filtered,
      projects: filteredProjects,
      entryKeyOf: salespersonOf,
      projectKeyOf: projectSalespersonOf,
      // Everyone with an account shows up, even at zero.
      keys: users.filter(u => !u.disabled).map(u => u.id),
      labelOf: (key) => (key === "Not set" ? "Not set" : personLabel(key))
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, filteredProjects, users]
  );

  const byWorkType = useMemo(
    () => combinedBreakdown({
      entries: filtered,
      projects: filteredProjects,
      entryKeyOf: e => e.workType,
      projectKeyOf: p => p.workType,
      keys: WORK_TYPES
    }),
    [filtered, filteredProjects]
  );

  const filterDefs = [
    { key: "show", label: "Show", type: "select", anyLabel: "Pipeline & projects", options: [
      { value: "pipeline", label: "Pipeline only" },
      { value: "projects", label: "Projects only" }
    ] },
    { key: "created", label: "Created", type: "date", presets: ["last30", "last90", "thisYear", "lastYear"] },
    { key: "sector", label: "Sector", type: "select", options: BUILDING_SECTORS.map(v => ({ value: v, label: v })) },
    { key: "workType", label: "Work type", type: "select", options: WORK_TYPES.map(v => ({ value: v, label: v })) },
    // Every active person is listed, whether or not they have anything yet.
    { key: "person", label: "Salesperson", type: "select", options: users.filter(u => !u.disabled).map(u => ({ value: u.id, label: personLabel(u.id) })).sort((a, b) => a.label.localeCompare(b.label)) },
    { key: "stage", label: "Stage (pipeline)", type: "select", options: optionsFrom(entries.map(e => e.stage)) },
    { key: "status", label: "Status (projects)", type: "select", options: optionsFrom(projects.map(p => p.category)) }
  ];

  if (loadError) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">Couldn't load analytics</h3>
          <p className="modal-subtitle">{loadError}</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div className="dashboard-page">
        <div className="admin-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">No access to Analytics</h3>
          <p className="modal-subtitle">Estimating Analytics is available to the Estimating Department and admins. Ask an admin to turn it on for your account.</p>
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>Back to My Projects</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div className="dashboard-page">Loading...</div>;
  }

  const anyFilter = Object.values(filters).some(isFilterActive);

  const exportEntries = (format) => downloadTable({
    format,
    filename: `pipeline-entries-${csvDateStamp()}`,
    headers: ["Title", "Status", "Stage", "Sector", "Salesperson", "Engineering firm", "Bid date", "Estimated value (as entered)", "Estimated value ($)", "Work type",
      "Manufacturers", "Bidders", "Won by / lost to", "Reason (lost / did not bid)", "Created", "Resolved", "Converted to project"],
    rows: filtered.map(e => [
      e.title, STATUS_LABEL[statusOf(e)], e.stage, e.buildingSector, personLabel(salespersonOf(e)), e.company, e.bidDate,
      e.value, parseMoney(e.value) ?? "", e.workType || "",
      Array.from(new Set(manufacturersOf(e).filter(Boolean))).join("; "),
      (e.biddingCompanies || []).filter(b => b.company).map(b => `${b.company}${b.salespersonId ? ` - ${personLabel(b.salespersonId)}` : ""}`).join("; "),
      e.wonByContractor || e.lostTo || "",
      e.lostReason || "",
      String(e.createdAt || "").slice(0, 10), String(e.resolvedAt || "").slice(0, 10),
      e.convertedToProjectId ? "Yes" : "No"
    ])
  });

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <MobileNav uid={uid} />
          <img src="/logo.svg" alt="Bullock Logan" className="dashboard-logo" />
          <h1 className="dashboard-title">Estimating Analytics</h1>
        </div>
        <div className="dashboard-header-actions">
          <button className="btn btn-secondary" onClick={() => router.push("/dashboard#personal")}>← Back to My Projects</button>
          <DashboardHeader uid={uid} />
        </div>
      </div>

      <FilterBar
        idPrefix="analytics-filter"
        filters={filterDefs}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({})}
        resultCount={filtered.length + filteredProjects.length}
        resultNoun={`records (${filtered.length} pipeline, ${filteredProjects.length} project${filteredProjects.length === 1 ? "" : "s"})`}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: -6, marginBottom: 14 }}>
        <ExportButtons label="these entries" buttonText="Export these entries" onExport={exportEntries} />
      </div>

      <h2 className="analytics-section-title">Bids</h2>
      <div className="stat-row">
        <StatTile label="Total entries" value={stats.total} sub={anyFilter ? "Matching filters" : "All pipeline entries"} />
        <StatTile label="Bid on" value={stats.bidOn} sub="Everything except Did Not Bid" />
        <StatTile label="Won" value={stats.won} />
        <StatTile label="Lost" value={stats.lost} />
        <StatTile label="Did Not Bid" value={stats.dnb} />
        <StatTile label="Still open" value={stats.open} />
        <StatTile label="Win rate" value={pct(stats.winRate)} sub={stats.decided ? `${stats.won} of ${stats.decided} decided bids` : "No decided bids yet"} />
      </div>

      <h2 className="analytics-section-title">Volume</h2>
      <div className="stat-row">
        <StatTile label="Total bid volume" value={formatMoney(stats.volume.total)} />
        <StatTile label="Won volume" value={formatMoney(stats.volume.won)} />
        <StatTile label="Lost volume" value={formatMoney(stats.volume.lost)} />
        <StatTile label="Open volume" value={formatMoney(stats.volume.open)} sub="Still in the pipeline" />
        <StatTile label="Avg. won job" value={stats.avgWonValue ? formatMoney(stats.avgWonValue) : "—"} />
      </div>
      {stats.missingValue > 0 && (
        <p className="private-note-hint" style={{ marginTop: -4 }}>
          {stats.missingValue} of {stats.total} entries have no usable estimated value (blank or not a number), so they aren't counted in volume.
        </p>
      )}

      <h2 className="analytics-section-title">Projects</h2>
      <div className="stat-row">
        <StatTile label="Projects" value={projectStats.count} sub={anyFilter ? "Matching filters" : "All projects"} />
        <StatTile label="Ongoing" value={projectStats.ongoing} />
        <StatTile label="Closed" value={projectStats.closed} />
        <StatTile label="Project volume" value={formatMoney(projectStats.volume)} />
        <StatTile label="Avg. project" value={projectStats.avgValue ? formatMoney(projectStats.avgValue) : "—"} />
      </div>
      {projectStats.missingValue > 0 && (
        <p className="private-note-hint" style={{ marginTop: -4 }}>
          {projectStats.missingValue} of {projectStats.count} projects have no usable value, so they aren&apos;t counted in project volume.
        </p>
      )}

      <h2 className="analytics-section-title">Pipeline forecast</h2>
      <div className="stat-row">
        {["next30", "next60", "next90", "pastDue"].map(k => {
          const w = forecast.windows[k];
          return (
            <StatTile
              key={k}
              label={w.label}
              value={formatMoney(w.volume)}
              sub={`${w.count} open ${w.count === 1 ? "entry" : "entries"}${k === "pastDue" && w.count ? " still need an outcome" : ""}`}
            />
          );
        })}
      </div>

      <div className="analytics-card">
        <div className="analytics-card-head" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="analytics-card-title">Upcoming bids</h3>
            <p className="analytics-card-sub">Open entries bidding in the next 90 days</p>
          </div>
          {forecast.upcoming.length > 0 && (
            <ExportButtons label="upcoming bids" onExport={(format) => downloadTable({
              format,
              filename: `upcoming-bids-${csvDateStamp()}`,
              headers: ["Bid date", "Title", "Stage", "Sector", "Salesperson", "Engineering firm", "Estimated value ($)", "Work type"],
              rows: forecast.upcoming.map(e => [e.bidDate, e.title, e.stage, e.buildingSector, personLabel(salespersonOf(e)), e.company, parseMoney(e.value) ?? "", e.workType || ""])
            })} />
          )}
        </div>
        {forecast.upcoming.length === 0 ? (
          <p className="private-note-hint">No open entries bid in the next 90 days.</p>
        ) : (
          <div className="analytics-table-wrap">
            <table className="analytics-table stack-on-phone">
              <thead>
                <tr><th>Opportunity</th><th>Bid date</th><th>Stage</th><th>Sector</th><th>Salesperson</th><th>Value</th><th>Work type</th></tr>
              </thead>
              <tbody>
                {forecast.upcoming.map(e => (
                  <tr key={e.id} className="analytics-row-link" onClick={() => router.push(`/dashboard/pipeline/${e.id}`)}>
                    <td className="analytics-table-name" data-label="Opportunity">{e.title}</td>
                    <td data-label="Bid date">{e.bidDate}</td>
                    <td data-label="Stage">{e.stage || "—"}</td>
                    <td data-label="Sector">{e.buildingSector || "—"}</td>
                    <td data-label="Salesperson">{personLabel(salespersonOf(e))}</td>
                    <td data-label="Value">{parseMoney(e.value) === null ? "—" : formatMoney(parseMoney(e.value))}</td>
                    <td data-label="Work type">{e.workType || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <OutcomesChart buckets={months} />

      {(myProfile?.role === "estimating" || myProfile?.role === "admin") && (
        <div className="analytics-card">
          <h3 className="analytics-card-title">Export a person's data</h3>
          <p className="analytics-card-sub">
            Download one person's projects, pipeline, and past projects. Their private notes are only included for projects you collaborate on. Admins' data can't be exported.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label className="sr-only" htmlFor="export-person">Person</label>
            <select id="export-person" className="field" style={{ maxWidth: 280, marginBottom: 0 }} value={exportPersonId} onChange={e => setExportPersonId(e.target.value)}>
              <option value="">Choose a person...</option>
              {users
                // An admin's data can only be exported by that admin.
                .filter(u => !u.disabled && u.id !== uid && u.role !== "admin")
                .sort((a, b) => personLabel(a.id).localeCompare(personLabel(b.id)))
                .map(u => <option key={u.id} value={u.id}>{personLabel(u.id)}</option>)}
            </select>
            <button
              className="btn btn-secondary"
              disabled={!exportPersonId}
              onClick={() => setExportTarget(users.find(u => u.id === exportPersonId))}
            >
              Export…
            </button>
          </div>
        </div>
      )}

      {exportTarget && myProfile && (
        <ExportDataModal viewer={{ id: uid, ...myProfile }} target={exportTarget} onClose={() => setExportTarget(null)} />
      )}

      <CombinedTable
        title="By work type"
        nameHeader="Work type"
        filename="by-work-type"
        sub="New installation, replacement, or repair, across pipeline entries and projects."
        rows={byWorkType}
      />
      <CombinedTable
        title="By salesperson"
        nameHeader="Salesperson"
        filename="by-salesperson"
        sub="Pipeline entries count for the assigned salesperson (or whoever created them); projects count for their owner. Everyone is listed, even at zero."
        rows={byPerson}
      />
      <BreakdownTable title="By sector (pipeline)" nameHeader="Sector" filename="by-sector" sub="Entries missing a sector show as Not set." rows={bySector} />
      <BreakdownTable title="By engineering firm (pipeline)" nameHeader="Engineering firm" filename="by-engineering-firm" sub="The engineering firm on each pipeline entry." rows={byFirm} />
      <BreakdownTable
        title="By manufacturer (pipeline)"
        nameHeader="Manufacturer"
        filename="by-manufacturer"
        sub="Every manufacturer quoted on an entry. An entry quoting two manufacturers counts under both, so these rows can add up to more than the total."
        rows={byManufacturer}
      />
    </div>
  );
}
