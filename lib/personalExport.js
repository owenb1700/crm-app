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
export async function exportProjects({ target, format }) {
  const { customers, users } = await loadAll();
  const who = nameFor(users);
  const rows = customers
    .filter(c => isMyProject(c, target.id) && c.category !== "Project Closed")
    .sort((a, b) => day(a.nextCheckIn).localeCompare(day(b.nextCheckIn)));
  downloadTable({ format, filename: `projects-${slug(personName(target))}-${csvDateStamp()}`, sheetName: "Projects",
    headers: ["Project", "Their role", "Owner", "Status", "Sector", "Firm type", "Contractor / owner", "Contact", "Email", "Phone",
      "Project address", "Value (as entered)", "Value ($)", "Next check-in", "Last contact", "Owners & building engineers", "Equipment", "Created"],
    rows: rows.map(c => [
      c.projectName || c.company, projectRole(c, target.id), who(c.ownerId), c.category, c.buildingSector,
      firmTypeOf(c.companyCategory), c.company, c.contact, c.email, c.phone, c.projectAddress,
      c.projectValue, parseMoney(c.projectValue) ?? "", day(c.nextCheckIn), day(c.lastContact),
      (c.owners || []).map(o => [o.company, o.contact].filter(Boolean).join(" — ")).join("; "),
      equipmentRowsFrom(c).map(r => [r.type, r.manufacturer, r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(" ")).join("; "),
      day(c.createdAt)
    ]) });
  return rows.length;
}

export async function exportPipeline({ target, format }) {
  const { pipeline, users } = await loadAll();
  const who = nameFor(users);
  const rows = pipeline
    .filter(p => isMyPipeline(p, target.id))
    .sort((a, b) => String(a.bidDate || "9999").localeCompare(String(b.bidDate || "9999")));
  downloadTable({ format, filename: `pipeline-${slug(personName(target))}-${csvDateStamp()}`, sheetName: "Pipeline",
    headers: ["Opportunity", "Their role", "Status", "Stage", "Sector", "Bid date", "Value (as entered)", "Value ($)", "Engineering firm", "Contact",
      "Email", "Phone", "Project address", "Owner", "Salesperson", "Point person", "Bidders", "Won by / lost to", "Reason", "Converted to project", "Created", "Resolved"],
    rows: rows.map(p => [
      p.title, pipelineRoles(p, target.id), STATUS_LABEL[statusOf(p)], p.stage, p.buildingSector, p.bidDate,
      p.value, parseMoney(p.value) ?? "", p.company, p.contact, p.email, p.phone, p.projectAddress,
      who(p.ownerId), who(p.salespersonId), who(p.projectPointPersonId),
      (p.biddingCompanies || []).map(b => `${b.company || ""}${b.category && b.category !== "Contractor" ? ` (${b.category})` : ""}`).filter(Boolean).join("; "),
      p.wonByContractor || p.lostTo || "", p.lostReason || "", p.convertedToProjectId ? "Yes" : "No",
      day(p.createdAt), day(p.resolvedAt)
    ]) });
  return rows.length;
}

export async function exportPastProjects({ target, format }) {
  const { customers, pipeline, users } = await loadAll();
  const who = nameFor(users);
  const closed = customers.filter(c => isMyProject(c, target.id) && c.category === "Project Closed");
  const resolved = pipeline.filter(p => isMyPipeline(p, target.id) && p.outcome);
  const lastLoss = (c) => [...(c.activityLog || [])].reverse().find(a => a.type === "completed" && a.outcome === "Lost");
  const rows = [
    ...closed.map(c => ({
      sort: day(c.closedAt || c.lastContact || c.createdAt),
      cells: ["Project", c.projectName || c.company, projectRole(c, target.id), who(c.ownerId),
        c.closedOutcome === "Closed" ? "Project Closed" : (c.closedOutcome || "Closed"), c.buildingSector, c.company,
        day(c.closedAt), c.lostReason || lastLoss(c)?.notes || "", c.lostTo || lastLoss(c)?.lostTo || "",
        day(c.nextCheckIn), c.projectValue, parseMoney(c.projectValue) ?? ""]
    })),
    ...resolved.map(p => ({
      sort: day(p.resolvedAt),
      cells: ["Pipeline", p.title, pipelineRoles(p, target.id), who(p.ownerId), p.outcome, p.buildingSector, p.company,
        day(p.resolvedAt), p.lostReason || "", p.wonByContractor || p.lostTo || "",
        day(p.nextCheckIn), p.value, parseMoney(p.value) ?? ""]
    }))
  ].sort((a, b) => b.sort.localeCompare(a.sort));
  downloadTable({ format, filename: `past-projects-${slug(personName(target))}-${csvDateStamp()}`, sheetName: "Past Projects",
    headers: ["Type", "Name", "Their role", "Owner", "Outcome", "Sector", "Contractor / engineering firm", "Closed / resolved",
      "Reason (lost / did not bid)", "Won by / lost to", "Next check-in", "Value (as entered)", "Value ($)"],
    rows: rows.map(r => r.cells) });
  return rows.length;
}

// Private notes. Someone exporting their own data gets the notes on every
// project they own or collaborate on, and on pipeline entries they own.
// Someone exporting ANOTHER person's data only gets notes from that
// person's projects that the exporter is personally a collaborator (or
// co-owner) on -- never pipeline notes, even for an admin, whose database
// access would technically allow it.
export async function exportNotes({ target, viewer, format }) {
  const { customers, pipeline, users } = await loadAll();
  const isSelf = target.id === viewer.id;

  const projects = customers.filter(c =>
    isMyProject(c, target.id) && (isSelf || isMyProject(c, viewer.id))
  );
  const pipelines = isSelf ? pipeline.filter(p => p.ownerId === target.id) : [];

  const rows = [];
  const addNotes = (type, name, data) => {
    if (!data) return;
    if (data.notes) rows.push([type, name, "Current", data.notesAuthorName || "", "", data.notes]);
    (data.notesHistory || []).forEach(h => rows.push([type, name, "Earlier version", h.authorName || "", day(h.date), h.text]));
  };

  await Promise.all([
    ...projects.map(async c => {
      try {
        const snap = await getDoc(doc(db, "customers", c.id, "private", "data"));
        if (snap.exists()) addNotes("Project", c.projectName || c.company, snap.data());
      } catch {
        // No access to this project's notes -- leave it out.
      }
    }),
    ...pipelines.map(async p => {
      try {
        const snap = await getDoc(doc(db, "pipeline", p.id, "private", "data"));
        if (snap.exists()) addNotes("Pipeline", p.title, snap.data());
      } catch {
        // No access -- leave it out.
      }
    })
  ]);

  rows.sort((a, b) => a[1].localeCompare(b[1]) || (a[2] === "Current" ? -1 : b[2] === "Current" ? 1 : b[4].localeCompare(a[4])));
  downloadTable({ format, filename: `notes-${slug(personName(target))}-${csvDateStamp()}`, sheetName: "Notes",
    headers: ["Type", "Name", "Version", "Written by", "Replaced on", "Note"], rows });
  return rows.length;
}

// Reminders are private to their owner, so this is only ever self-export.
export async function exportMyReminders({ viewer, format }) {
  const [snap, pipelineSnap] = await Promise.all([
    getDocs(query(collection(db, "reminders"), where("userId", "==", viewer.id))),
    getDocs(collection(db, "pipeline"))
  ]);
  const titles = new Map(pipelineSnap.docs.map(d => [d.id, d.data().title]));
  const rows = snap.docs
    .map(d => d.data())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(r => [r.date, r.pipelineId ? "Pipeline alert" : "Reminder", r.subject, r.pipelineId ? (titles.get(r.pipelineId) || "") : "", r.notes || "", day(r.createdAt)]);
  downloadTable({ format, filename: `reminders-${slug(personName(viewer))}-${csvDateStamp()}`, sheetName: "Reminders",
    headers: ["Date", "Type", "Subject", "Pipeline entry", "Notes", "Created"], rows });
  return rows.length;
}
