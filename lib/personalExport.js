import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { downloadTable, csvDateStamp } from "./csv";
import { equipmentRowsFrom } from "./equipment";
import { firmTypeOf } from "./directory";
import { parseMoney, statusOf } from "./analytics";

const STATUS_LABEL = { won: "Won", lost: "Lost", dnb: "Did Not Bid", open: "Open" };
const day = (v) => (v?.seconds ? new Date(v.seconds * 1000).toISOString().slice(0, 10) : String(v || "").slice(0, 10));
const slug = (s) => String(s || "user").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const personName = (u) => (u ? (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email) : "Unknown");

// Which records count as someone's own -- the same relationships the
// dashboard uses to put them on that person's lists.
export const isMyProject = (c, uid) => c.ownerId === uid || (c.collaboratorIds || []).includes(uid);
export const isMyPipeline = (p, uid) =>
  p.ownerId === uid || p.salespersonId === uid || p.projectPointPersonId === uid || (p.trackedByIds || []).includes(uid);

async function loadAll() {
  const [customersSnap, pipelineSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, "customers")),
    getDocs(collection(db, "pipeline")),
    getDocs(collection(db, "users"))
  ]);
  return {
    customers: customersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    pipeline: pipelineSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  };
}

const nameFor = (users) => (id) => (id ? personName(users.find(u => u.id === id)) : "");

const projectRole = (c, uid) => (c.ownerId === uid ? "Owner" : "Collaborator");
const pipelineRoles = (p, uid) => [
  p.ownerId === uid && "Owner",
  p.salespersonId === uid && "Salesperson",
  p.projectPointPersonId === uid && "Point person",
  (p.trackedByIds || []).includes(uid) && "Tracking"
].filter(Boolean).join("; ");

// Every export takes the person whose data it is (`target`) and the person
// downloading it (`viewer`). They're the same for Export My Data.
//
// An admin's data can only ever be exported by that admin themselves.
export const canExportPerson = (viewer, target) =>
  !!viewer && !!target && (viewer.id === target.id || (target.role !== "admin" && (viewer.role === "admin" || viewer.role === "estimating")));

const assertCanExport = (viewer, target) => {
  if (!canExportPerson(viewer, target)) {
    throw new Error(target?.role === "admin" ? "An admin's data can't be exported by anyone else." : "You don't have permission to export this person's data.");
  }
};
export async function exportProjects({ target, viewer, format, includeNotes = false }) {
  assertCanExport(viewer, target);
  const { customers, users } = await loadAll();
  const who = nameFor(users);
  const rows = customers
    .filter(c => isMyProject(c, target.id) && c.category !== "Project Closed")
    .sort((a, b) => day(a.nextCheckIn).localeCompare(day(b.nextCheckIn)));
  const notes = includeNotes ? await loadNotes("project", rows, c => canReadProjectNotes(c, viewer, target)) : null;
  await downloadTable({ format, filename: `projects-${slug(personName(target))}-${csvDateStamp()}`, sheetName: "Projects",
    headers: ["Project", "Their role", "Owner", "Status", "Sector", "Firm type", "Contractor / owner", "Contact", "Email", "Phone",
      "Project address", "Value (as entered)", "Value ($)", "Work type", "Next check-in", "Last contact", "Owners & building engineers", "Equipment", "Created", ...(notes ? NOTE_HEADERS : [])],
    rows: rows.map(c => [
      c.projectName || c.company, projectRole(c, target.id), who(c.ownerId), c.category, c.buildingSector,
      firmTypeOf(c.companyCategory), c.company, c.contact, c.email, c.phone, c.projectAddress,
      c.projectValue, parseMoney(c.projectValue) ?? "", c.workType || "", day(c.nextCheckIn), day(c.lastContact),
      (c.owners || []).map(o => [o.company, o.contact].filter(Boolean).join(" — ")).join("; "),
      equipmentRowsFrom(c).map(r => [r.type, r.manufacturer, r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(" ")).join("; "),
      day(c.createdAt),
      ...(notes ? (notes.get(c.id) || BLANK_NOTES) : [])
    ]) });
  return rows.length;
}

export async function exportPipeline({ target, viewer, format, includeNotes = false }) {
  assertCanExport(viewer, target);
  const { pipeline, users } = await loadAll();
  const who = nameFor(users);
  const rows = pipeline
    .filter(p => isMyPipeline(p, target.id))
    .sort((a, b) => String(a.bidDate || "9999").localeCompare(String(b.bidDate || "9999")));
  const notes = includeNotes ? await loadNotes("pipeline", rows, p => canReadPipelineNotes(p, viewer, target)) : null;
  await downloadTable({ format, filename: `pipeline-${slug(personName(target))}-${csvDateStamp()}`, sheetName: "Pipeline",
    headers: ["Opportunity", "Their role", "Status", "Stage", "Sector", "Bid date", "Value (as entered)", "Value ($)", "Work type", "Engineering firm", "Contact",
      "Email", "Phone", "Project address", "Owner", "Salesperson", "Point person", "Bidders", "Won by / lost to", "Reason", "Converted to project", "Created", "Resolved", ...(notes ? NOTE_HEADERS : [])],
    rows: rows.map(p => [
      p.title, pipelineRoles(p, target.id), STATUS_LABEL[statusOf(p)], p.stage, p.buildingSector, p.bidDate,
      p.value, parseMoney(p.value) ?? "", p.workType || "", p.company, p.contact, p.email, p.phone, p.projectAddress,
      who(p.ownerId), who(p.salespersonId), who(p.projectPointPersonId),
      (p.biddingCompanies || []).filter(b => b.company).map(b => `${b.company}${b.category && b.category !== "Contractor" ? ` (${b.category})` : ""}${b.salespersonId ? ` - ${who(b.salespersonId)}` : ""}`).join("; "),
      p.wonByContractor || p.lostTo || "", p.lostReason || "", p.convertedToProjectId ? "Yes" : "No",
      day(p.createdAt), day(p.resolvedAt),
      ...(notes ? (notes.get(p.id) || BLANK_NOTES) : [])
    ]) });
  return rows.length;
}

export async function exportPastProjects({ target, viewer, format, includeNotes = false }) {
  assertCanExport(viewer, target);
  const { customers, pipeline, users } = await loadAll();
  const who = nameFor(users);
  const closed = customers.filter(c => isMyProject(c, target.id) && c.category === "Project Closed");
  const resolved = pipeline.filter(p => isMyPipeline(p, target.id) && p.outcome);
  const [projectNotes, pipelineNotes] = includeNotes
    ? await Promise.all([
        loadNotes("project", closed, c => canReadProjectNotes(c, viewer, target)),
        loadNotes("pipeline", resolved, p => canReadPipelineNotes(p, viewer, target))
      ])
    : [null, null];
  const lastLoss = (c) => [...(c.activityLog || [])].reverse().find(a => a.type === "completed" && a.outcome === "Lost");
  const rows = [
    ...closed.map(c => ({
      sort: day(c.closedAt || c.lastContact || c.createdAt),
      cells: ["Project", c.projectName || c.company, projectRole(c, target.id), who(c.ownerId),
        c.closedOutcome === "Closed" ? "Project Closed" : (c.closedOutcome || "Closed"), c.buildingSector, c.company,
        day(c.closedAt), c.lostReason || lastLoss(c)?.notes || "", c.lostTo || lastLoss(c)?.lostTo || "",
        day(c.nextCheckIn), c.projectValue, parseMoney(c.projectValue) ?? "", c.workType || "",
        ...(projectNotes ? (projectNotes.get(c.id) || BLANK_NOTES) : [])]
    })),
    ...resolved.map(p => ({
      sort: day(p.resolvedAt),
      cells: ["Pipeline", p.title, pipelineRoles(p, target.id), who(p.ownerId), p.outcome, p.buildingSector, p.company,
        day(p.resolvedAt), p.lostReason || "", p.wonByContractor || p.lostTo || "",
        day(p.nextCheckIn), p.value, parseMoney(p.value) ?? "", p.workType || "",
        ...(pipelineNotes ? (pipelineNotes.get(p.id) || BLANK_NOTES) : [])]
    }))
  ].sort((a, b) => b.sort.localeCompare(a.sort));
  await downloadTable({ format, filename: `past-projects-${slug(personName(target))}-${csvDateStamp()}`, sheetName: "Past Projects",
    headers: ["Type", "Name", "Their role", "Owner", "Outcome", "Sector", "Contractor / engineering firm", "Closed / resolved",
      "Reason (lost / did not bid)", "Won by / lost to", "Next check-in", "Value (as entered)", "Value ($)", "Work type", ...(includeNotes ? NOTE_HEADERS : [])],
    rows: rows.map(r => r.cells) });
  return rows.length;
}

// Private notes, added as extra columns when "Include notes" is checked.
// Someone exporting their own data gets notes on every project they own or
// collaborate on, and on pipeline entries they own. Someone exporting
// ANOTHER person's data only gets notes from that person's projects that
// the exporter personally owns or collaborates on -- never pipeline notes,
// even for an admin, whose database access would technically allow it.
// Rows without access keep the columns, left blank.
const NOTE_HEADERS = ["Current note", "Note written by", "Earlier notes"];
const BLANK_NOTES = ["", "", ""];

const canReadProjectNotes = (c, viewer, target) =>
  target.id === viewer.id ? isMyProject(c, target.id) : isMyProject(c, viewer.id);
const canReadPipelineNotes = (p, viewer, target) =>
  target.id === viewer.id && p.ownerId === target.id;

async function loadNotes(kind, records, allowed) {
  const notes = new Map();
  await Promise.all(records.filter(allowed).map(async r => {
    try {
      const snap = await getDoc(doc(db, kind === "project" ? "customers" : "pipeline", r.id, "private", "data"));
      if (!snap.exists()) return;
      const data = snap.data();
      const earlier = [...(data.notesHistory || [])]
        .sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")))
        .map(h => `${day(h.date)}${h.authorName ? ` (${h.authorName})` : ""}: ${h.text || ""}`)
        .join("\n");
      notes.set(r.id, [data.notes || "", data.notes ? (data.notesAuthorName || "") : "", earlier]);
    } catch {
      // No access to this record's notes -- its columns stay blank.
    }
  }));
  return notes;
}

// Reminders are private to their owner, so this is only ever self-export.
export async function exportMyReminders({ viewer, format }) {
  const [snap, pipelineSnap, customersSnap] = await Promise.all([
    getDocs(query(collection(db, "reminders"), where("userId", "==", viewer.id))),
    getDocs(collection(db, "pipeline")),
    getDocs(collection(db, "customers"))
  ]);
  const titles = new Map(pipelineSnap.docs.map(d => [d.id, d.data().title]));
  const projectTitles = new Map(customersSnap.docs.map(d => [d.id, d.data().projectName || d.data().company]));
  const rows = snap.docs
    .map(d => d.data())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(r => [r.date, r.projectId ? "Project" : r.pipelineId ? "Pipeline entry" : "", r.subject,
      r.projectId ? (projectTitles.get(r.projectId) || "") : r.pipelineId ? (titles.get(r.pipelineId) || "") : "", r.notes || "", day(r.createdAt)]);
  await downloadTable({ format, filename: `reminders-${slug(personName(viewer))}-${csvDateStamp()}`, sheetName: "Reminders",
    headers: ["Date", "Attached to", "Subject", "Job", "Notes", "Created"], rows });
  return rows.length;
}
