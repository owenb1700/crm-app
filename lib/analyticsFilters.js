import { matchesDateFilter } from "./dateFilter";
import { statusOf, bidForecast } from "./analytics";

// The Analytics page and its detail pages share one definition of the
// filters and of what sits behind each number on the page, so a tile always
// opens exactly the records it counted.

export const salespersonOfEntry = (e) => e.salespersonId || e.ownerId;
export const salespersonOfProject = (p) => p.ownerId;

export const filterEntries = (entries, filters = {}) =>
  (filters.show === "projects" ? [] : entries || [])
    .filter(e => !filters.sector || e.buildingSector === filters.sector)
    .filter(e => !filters.workType || e.workType === filters.workType)
    .filter(e => !filters.person || salespersonOfEntry(e) === filters.person)
    .filter(e => !filters.stage || e.stage === filters.stage)
    .filter(e => matchesDateFilter(e.createdAt, filters.created));

// Stage is a pipeline-only idea, so picking one leaves projects out.
export const filterProjects = (projects, filters = {}) =>
  (filters.show === "pipeline" || filters.stage ? [] : projects || [])
    .filter(p => !filters.sector || p.buildingSector === filters.sector)
    .filter(p => !filters.workType || p.workType === filters.workType)
    .filter(p => !filters.person || salespersonOfProject(p) === filters.person)
    .filter(p => !filters.status || p.category === filters.status)
    .filter(p => matchesDateFilter(p.createdAt, filters.created));

// Filters travel to a detail page in the URL.
export const encodeFilters = (filters) => {
  const active = Object.fromEntries(Object.entries(filters || {}).filter(([, v]) => (typeof v === "object" && v !== null ? v.preset : v)));
  return Object.keys(active).length ? encodeURIComponent(JSON.stringify(active)) : "";
};

export const decodeFilters = (value) => {
  if (!value) return {};
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return {};
  }
};

// A replacement that never went through the pipeline is still a job we won,
// so it belongs with the bids.
export const isStandaloneReplacement = (p) => p.workType === "Replacement" && !p.sourcePipelineId;

// Bids: every pipeline entry, plus replacement projects that were never bid.
export const bidRecords = ({ entries = [], projects = [] }) => ({
  entries,
  projects: projects.filter(isStandaloneReplacement)
});

// Repairs are jobs we do, not jobs we bid.
export const repairRecords = ({ projects = [] }) => ({ entries: [], projects: projects.filter(p => p.workType === "Repair") });

// Volume counts every job once. A pipeline entry that became a project is
// counted as the project, so converted entries drop out here.
export const volumeRecords = ({ entries = [], projects = [] }) => ({
  entries: entries.filter(e => !e.convertedToProjectId),
  projects
});

// What each number on the Analytics page is made of. `records` gets the
// already-filtered lists and returns the rows behind that tile.
export const METRICS = {
  total: { label: "All bids", sub: "Pipeline entries plus replacement projects that were never bid", records: bidRecords },
  bidOn: { label: "Bid on", sub: "Everything except Did Not Bid", records: (lists) => withStatus(bidRecords(lists), s => s !== "dnb") },
  won: { label: "Won", records: (lists) => withStatus(bidRecords(lists), s => s === "won") },
  lost: { label: "Lost", records: (lists) => withStatus(bidRecords(lists), s => s === "lost") },
  dnb: { label: "Did Not Bid", records: (lists) => withStatus(bidRecords(lists), s => s === "dnb") },
  open: { label: "Still open", records: (lists) => withStatus(bidRecords(lists), s => s === "open") },
  winRate: { label: "Decided bids", sub: "Won and lost, the two the win rate is based on", records: (lists) => withStatus(bidRecords(lists), s => s === "won" || s === "lost") },

  volumeTotal: { label: "Total volume", sub: "Every job counted once -- converted pipeline entries count as their project", records: volumeRecords },
  volumeWon: { label: "Won volume", records: (lists) => withStatus(volumeRecords(lists), s => s === "won") },
  volumeLost: { label: "Lost volume", records: (lists) => withStatus(volumeRecords(lists), s => s === "lost") },
  volumeOpen: { label: "Open volume", records: (lists) => withStatus(volumeRecords(lists), s => s === "open") },
  avgWon: { label: "Won jobs", sub: "The jobs the average is taken from", records: (lists) => withStatus(volumeRecords(lists), s => s === "won") },

  projects: { label: "Repair projects", records: repairRecords },
  projectsOngoing: { label: "Ongoing repair projects", records: (lists) => ({ entries: [], projects: repairRecords(lists).projects.filter(p => p.category !== "Project Closed") }) },
  projectsClosed: { label: "Closed repair projects", records: (lists) => ({ entries: [], projects: repairRecords(lists).projects.filter(p => p.category === "Project Closed") }) },
  projectVolume: { label: "Repair volume", records: repairRecords },
  avgProject: { label: "Repair projects", sub: "The projects the average is taken from", records: repairRecords },

  forecastNext30: { label: "Bids in the next 30 days", records: ({ entries = [] }) => ({ entries: bidForecast(entries).windows.next30.entries, projects: [] }) },
  forecastNext60: { label: "Bids in 31-60 days", records: ({ entries = [] }) => ({ entries: bidForecast(entries).windows.next60.entries, projects: [] }) },
  forecastNext90: { label: "Bids in 61-90 days", records: ({ entries = [] }) => ({ entries: bidForecast(entries).windows.next90.entries, projects: [] }) },
  forecastPastDue: { label: "Bid date passed", sub: "Open entries whose bid date has gone by", records: ({ entries = [] }) => ({ entries: bidForecast(entries).windows.pastDue.entries, projects: [] }) },
  upcomingBids: { label: "Upcoming bids", sub: "Open entries bidding in the next 90 days", records: ({ entries = [] }) => ({ entries: bidForecast(entries).upcoming, projects: [] }) }
};

// Projects count as won work, so a status filter keeps them only when it
// asks for won.
function withStatus({ entries, projects }, keep) {
  return {
    entries: entries.filter(e => keep(statusOf(e))),
    projects: keep("won") ? projects : []
  };
}
