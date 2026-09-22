import { downloadTable, csvDateStamp } from "./csv";
import { equipmentRowsFrom } from "./equipment";
import { firmTypeOf } from "./directory";
import { parseMoney, statusOf } from "./analytics";
import { personName } from "./people";
import { describeSplit, normalizeSplits } from "./splits";

// Downloads of what's on screen right now. My Projects and Pipeline both
// mix three kinds of card -- projects, pipeline entries and reminders --
// so one export covers whatever that page is showing, in the order it's
// showing them.
//
// Different from Export My Data (lib/personalExport.js), which gathers
// everything of a person's from the database. Here the page hands over the
// rows it already has, so the file matches the screen.

const STATUS_LABEL = { won: "Won", lost: "Lost", dnb: "Did Not Bid", open: "Open" };
const day = (v) => (v?.seconds ? new Date(v.seconds * 1000).toISOString().slice(0, 10) : String(v || "").slice(0, 10));
const slug = (s) => String(s || "view").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const nameFor = (users) => (id) => (id ? personName(users.find(u => u.id === id)) : "");

export const VIEW_HEADERS = [
  "Type", "Name", "Status", "Stage", "Sector", "Work type", "Date", "Value (as entered)", "Value ($)",
  "Firm type", "Firm", "Contact", "Email", "Phone", "Project address", "Owner", "Credit split",
  "Last contact", "Bidders", "Owners & building engineers", "Equipment", "Notes", "Attached to", "Created"
];

const blanks = (n) => Array(n).fill("");

const projectRow = (c, who) => [
  "Project", c.projectName || c.company || "", c.category || "", "", c.buildingSector || "", c.workType || "",
  day(c.nextCheckIn), c.projectValue || "", parseMoney(c.projectValue) ?? "",
  firmTypeOf(c.companyCategory), c.company || "", c.contact || "", c.email || "", c.phone || "", c.projectAddress || "",
  who(c.ownerId), normalizeSplits(c.splits).length ? describeSplit(c.splits, who) : "",
  day(c.lastContact), "",
  (c.owners || []).map(o => [o.company, o.contact].filter(Boolean).join(" — ")).join("; "),
  equipmentRowsFrom(c).map(r => [r.type, r.manufacturer, r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(" ")).join("; "),
  "", "", day(c.createdAt)
];

const pipelineRow = (p, who) => [
  "Pipeline", p.title || "", STATUS_LABEL[statusOf(p)], p.stage || "", p.buildingSector || "", p.workType || "",
  day(p.bidDate), p.value || "", parseMoney(p.value) ?? "",
  "Engineering Firm", p.company || "", p.contact || "", p.email || "", p.phone || "", p.projectAddress || "",
  who(p.ownerId), normalizeSplits(p.splits).length ? describeSplit(p.splits, who) : "",
  "",
  (p.biddingCompanies || []).filter(b => b.company)
    .map(b => `${b.company}${b.category && b.category !== "Contractor" ? ` (${b.category})` : ""}${b.salespersonId ? ` - ${who(b.salespersonId)}` : ""}`)
    .join("; "),
  "", "",
  [p.wonByContractor && `Won by ${p.wonByContractor}`, p.lostTo && `Lost to ${p.lostTo}`, p.lostReason].filter(Boolean).join(" — "),
  p.convertedToProjectId ? "Converted to a project" : "",
  day(p.createdAt)
];

// A reminder only fills the few columns that mean anything for it; the
// rest stay blank rather than repeating "n/a" down the sheet.
const reminderRow = (r, jobNameOf) => [
  "Reminder", r.subject || "", "", "", "", "", day(r.date), ...blanks(9),
  "", "", "", "", "", r.notes || "", jobNameOf(r), day(r.createdAt)
];

const sortKeyOf = (row) => row.date || "9999-12-31";

export async function exportDashboardView({
  page, projects = [], pipelineEntries = [], reminders = [], users = [], viewer, format,
  filtered = false, jobNameOf = () => ""
}) {
  const who = nameFor(users);
  const items = [
    ...projects.map(c => ({ date: day(c.nextCheckIn), cells: projectRow(c, who) })),
    ...pipelineEntries.map(p => ({ date: day(p.bidDate), cells: pipelineRow(p, who) })),
    ...reminders.map(r => ({ date: day(r.date), cells: reminderRow(r, jobNameOf) }))
  ].sort((a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b)));

  const base = { pipeline: "pipeline", team: "team-projects" }[page] || "my-projects";
  await downloadTable({
    format,
    // "filtered" in the name, so a narrowed list is never mistaken for the
    // whole book of business later.
    filename: `${base}-${slug(personName(viewer))}${filtered ? "-filtered" : ""}-${csvDateStamp()}`,
    sheetName: { pipeline: "Pipeline", team: "Team Projects" }[page] || "My Projects",
    headers: VIEW_HEADERS,
    rows: items.map(i => i.cells)
  });
  return items.length;
}
