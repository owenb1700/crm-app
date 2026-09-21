import { downloadTable, csvDateStamp } from "./csv";
import { equipmentRowsFrom } from "./equipment";
import { firmTypeOf } from "./directory";
import { parseMoney, statusOf } from "./analytics";
import { personName } from "./people";
import { describeSplit, normalizeSplits } from "./splits";

// Downloads of what's on screen right now -- the rows left after whatever
// filters the person has set, in the order they're looking at.
//
// This is deliberately different from Export My Data (lib/personalExport.js),
// which gathers everything of a given person's from the database. Here the
// caller passes the rows it already has, so the file matches the page.

const STATUS_LABEL = { won: "Won", lost: "Lost", dnb: "Did Not Bid", open: "Open" };
const day = (v) => (v?.seconds ? new Date(v.seconds * 1000).toISOString().slice(0, 10) : String(v || "").slice(0, 10));
const slug = (s) => String(s || "view").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const nameFor = (users) => (id) => (id ? personName(users.find(u => u.id === id)) : "");

// "Filtered" in the filename, so a partial list is never mistaken for the
// whole book of business later.
const fileName = (base, viewer, filtered) =>
  `${base}-${slug(personName(viewer))}${filtered ? "-filtered" : ""}-${csvDateStamp()}`;

export async function exportProjectView({ rows, users, viewer, format, filtered = false }) {
  const who = nameFor(users);
  await downloadTable({
    format,
    filename: fileName("my-projects", viewer, filtered),
    sheetName: "My Projects",
    headers: ["Project", "Status", "Sector", "Firm type", "Contractor / owner", "Contact", "Email", "Phone",
      "Project address", "Value (as entered)", "Value ($)", "Work type", "Next check-in", "Last contact",
      "Owner", "Credit split", "Owners & building engineers", "Equipment", "Created"],
    rows: rows.map(c => [
      c.projectName || c.company, c.category, c.buildingSector, firmTypeOf(c.companyCategory), c.company,
      c.contact, c.email, c.phone, c.projectAddress,
      c.projectValue, parseMoney(c.projectValue) ?? "", c.workType || "",
      day(c.nextCheckIn), day(c.lastContact), who(c.ownerId),
      normalizeSplits(c.splits).length ? describeSplit(c.splits, who) : "",
      (c.owners || []).map(o => [o.company, o.contact].filter(Boolean).join(" — ")).join("; "),
      equipmentRowsFrom(c).map(r => [r.type, r.manufacturer, r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(" ")).join("; "),
      day(c.createdAt)
    ])
  });
  return rows.length;
}

export async function exportPipelineView({ rows, users, viewer, format, filtered = false }) {
  const who = nameFor(users);
  await downloadTable({
    format,
    filename: fileName("pipeline", viewer, filtered),
    sheetName: "Pipeline",
    headers: ["Opportunity", "Status", "Stage", "Sector", "Bid date", "Value (as entered)", "Value ($)", "Work type",
      "Engineering firm", "Contact", "Email", "Phone", "Project address", "Owner", "Salesperson", "Point person",
      "Credit split", "Bidders", "Won by / lost to", "Reason", "Converted to project", "Created", "Resolved"],
    rows: rows.map(p => [
      p.title, STATUS_LABEL[statusOf(p)], p.stage, p.buildingSector, p.bidDate,
      p.value, parseMoney(p.value) ?? "", p.workType || "",
      p.company, p.contact, p.email, p.phone, p.projectAddress,
      who(p.ownerId), who(p.salespersonId), who(p.projectPointPersonId),
      normalizeSplits(p.splits).length ? describeSplit(p.splits, who) : "",
      (p.biddingCompanies || []).filter(b => b.company)
        .map(b => `${b.company}${b.category && b.category !== "Contractor" ? ` (${b.category})` : ""}${b.salespersonId ? ` - ${who(b.salespersonId)}` : ""}`)
        .join("; "),
      p.wonByContractor || p.lostTo || "", p.lostReason || "",
      p.convertedToProjectId ? "Yes" : "No", day(p.createdAt), day(p.resolvedAt)
    ])
  });
  return rows.length;
}
