import { getStorage } from "firebase-admin/storage";
import { getAdminDb, getAdminApp } from "./firebaseAdmin";
import { purgeAtFrom } from "./trash";

// Server-only. Permanently deletes a project or pipeline entry and
// everything that hangs off it, so nothing is left orphaned: subcollections
// (private notes, drawings, collaboration requests), uploaded files in
// Storage, everyone's reminders/alerts and notifications that point at it,
// and the cross-links between a converted pipeline entry and its project.
// Uses the Admin SDK because much of this (other people's reminders and
// notifications, private notes) is off-limits to any browser session.

const bucketName = () => process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

async function deleteStorageFolder(prefix) {
  const name = bucketName();
  if (!name) return 0;
  const bucket = getStorage(getAdminApp()).bucket(name);
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
  return files.length;
}

async function deleteMatching(query) {
  const snap = await query.get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
  return snap.size;
}

export async function loadRecord(kind, id) {
  const db = getAdminDb();
  const ref = db.collection(kind === "project" ? "customers" : "pipeline").doc(id);
  const snap = await ref.get();
  return snap.exists ? { ref, data: snap.data() } : null;
}

export async function deleteProjectCompletely(id) {
  const db = getAdminDb();
  const record = await loadRecord("project", id);
  if (!record) return null;

  const summary = { name: record.data.projectName || record.data.company || "Untitled project" };

  // Any pipeline entry this project was converted from becomes
  // unconverted again, so it can be converted anew if needed.
  const converted = await db.collection("pipeline").where("convertedToProjectId", "==", id).get();
  await Promise.all(converted.docs.map(d => d.ref.update({ convertedToProjectId: null, convertedAt: null })));
  summary.unlinkedPipeline = converted.size;

  summary.reminders = await deleteMatching(db.collection("reminders").where("projectId", "==", id));
  summary.notifications = await deleteMatching(db.collection("notifications").where("link", "==", `/dashboard/project/${id}`));
  summary.files = await deleteStorageFolder(`customers/${id}/`);

  // The project plus its private notes, drawings list, and collaboration
  // requests, in one recursive delete.
  await db.recursiveDelete(record.ref);
  return summary;
}

export async function deletePipelineCompletely(id) {
  const db = getAdminDb();
  const record = await loadRecord("pipeline", id);
  if (!record) return null;

  const summary = { name: record.data.title || "Untitled pipeline entry" };

  // A project converted from this entry keeps its Bid History (a frozen
  // copy) and still links to this entry's uploaded bid files -- so those
  // files are kept, and the project is marked as having lost its source.
  const projects = await db.collection("customers").where("sourcePipelineId", "==", id).get();
  await Promise.all(projects.docs.map(d => d.ref.update({ "bidHistory.pipelineDeleted": true })));
  summary.convertedProjects = projects.size;

  summary.reminders = await deleteMatching(db.collection("reminders").where("pipelineId", "==", id));
  summary.notifications = await deleteMatching(db.collection("notifications").where("link", "==", `/dashboard/pipeline/${id}`));
  summary.files = projects.size > 0 ? 0 : await deleteStorageFolder(`pipeline/${id}/`);
  summary.filesKeptForProject = projects.size > 0;

  await db.recursiveDelete(record.ref);
  return summary;
}

// Moves a project or pipeline entry to the Trash. Nothing attached to it is
// touched, so restoring brings it back exactly as it was; it's just hidden
// everywhere in the app until then.
export async function moveToTrash(kind, id, deletedBy) {
  const record = await loadRecord(kind, id);
  if (!record) return null;
  const deletedAt = new Date().toISOString();
  await record.ref.update({ deletedAt, deletedBy, purgeAt: purgeAtFrom(deletedAt) });
  return { deletedAt };
}

export async function restoreFromTrash(kind, id) {
  const record = await loadRecord(kind, id);
  if (!record) return null;
  await record.ref.update({ deletedAt: null, deletedBy: null, purgeAt: null });
  return { restored: true };
}

// Deletes, for good, everything whose 30 days in the Trash are up. Run by
// the daily job and whenever someone opens their Trash.
export async function purgeExpiredTrash(now = new Date()) {
  const db = getAdminDb();
  const cutoff = now.toISOString();
  const [projects, pipeline] = await Promise.all([
    db.collection("customers").where("deletedAt", ">", "").get(),
    db.collection("pipeline").where("deletedAt", ">", "").get()
  ]);
  const expired = (d) => (d.data().purgeAt || purgeAtFrom(d.data().deletedAt)) <= cutoff;
  const purged = [];
  for (const d of projects.docs.filter(expired)) {
    await deleteProjectCompletely(d.id);
    purged.push({ kind: "project", id: d.id });
  }
  for (const d of pipeline.docs.filter(expired)) {
    await deletePipelineCompletely(d.id);
    purged.push({ kind: "pipeline", id: d.id });
  }
  return purged;
}
