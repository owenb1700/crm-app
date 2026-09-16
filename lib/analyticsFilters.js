"use client";

import { matchesDateFilter } from "../app/components/FilterBar";
import { statusOf } from "./analytics";
import { bidForecast } from "./analytics";

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

// What each number on the Analytics page is made of. `records` gets the
// already-filtered lists and returns the rows behind that tile.
export const METRICS = {
  total: { label: "All pipeline entries", kind: "pipeline", records: ({ entries }) => entries },
  bidOn: { label: "Bid on", kind: "pipeline", sub: "Everything except Did Not Bid", records: ({ entries }) => entries.filter(e => statusOf(e) !== "dnb") },
  won: { label: "Won bids", kind: "pipeline", records: ({ entries }) => entries.filter(e => statusOf(e) === "won") },
  lost: { label: "Lost bids", kind: "pipeline", records: ({ entries }) => entries.filter(e => statusOf(e) === "lost") },
  dnb: { label: "Did Not Bid", kind: "pipeline", records: ({ entries }) => entries.filter(e => statusOf(e) === "dnb") },
  open: { label: "Open pipeline entries", kind: "pipeline", records: ({ entries }) => entries.filter(e => statusOf(e) === "open") },
  winRate: { label: "Decided bids", kind: "pipeline", sub: "Won and lost bids, the two the win rate is based on", records: ({ entries }) => entries.filter(e => ["won", "lost"].includes(statusOf(e))) },

  volumeTotal: { label: "Total bid volume", kind: "pipeline", records: ({ entries }) => entries },
  volumeWon: { label: "Won volume", kind: "pipeline", records: ({ entries }) => entries.filter(e => statusOf(e) === "won") },
  volumeLost: { label: "Lost volume", kind: "pipeline", records: ({ entries }) => entries.filter(e => statusOf(e) === "lost") },
  volumeOpen: { label: "Open volume", kind: "pipeline", records: ({ entries }) => entries.filter(e => statusOf(e) === "open") },
  avgWon: { label: "Won bids", kind: "pipeline", sub: "The won bids the average is taken from", records: ({ entries }) => entries.filter(e => statusOf(e) === "won") },

  projects: { label: "Projects", kind: "projects", records: ({ projects }) => projects },
  projectsOngoing: { label: "Ongoing projects", kind: "projects", records: ({ projects }) => projects.filter(p => p.category !== "Project Closed") },
  projectsClosed: { label: "Closed projects", kind: "projects", records: ({ projects }) => projects.filter(p => p.category === "Project Closed") },
  projectVolume: { label: "Project volume", kind: "projects", records: ({ projects }) => projects },
  avgProject: { label: "Projects", kind: "projects", sub: "The projects the average is taken from", records: ({ projects }) => projects },

  forecastNext30: { label: "Bids in the next 30 days", kind: "pipeline", records: ({ entries }) => bidForecast(entries).windows.next30.entries },
  forecastNext60: { label: "Bids in 31–60 days", kind: "pipeline", records: ({ entries }) => bidForecast(entries).windows.next60.entries },
  forecastNext90: { label: "Bids in 61–90 days", kind: "pipeline", records: ({ entries }) => bidForecast(entries).windows.next90.entries },
  forecastPastDue: { label: "Bid date passed", kind: "pipeline", sub: "Open entries whose bid date has gone by", records: ({ entries }) => bidForecast(entries).windows.pastDue.entries },
  upcomingBids: { label: "Upcoming bids", kind: "pipeline", sub: "Open entries bidding in the next 90 days", records: ({ entries }) => bidForecast(entries).upcoming }
};
