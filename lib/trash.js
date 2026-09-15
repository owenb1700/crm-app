// Deleted projects and pipeline entries aren't removed right away: they're
// marked with deletedAt / deletedBy and sit in the Trash (User Settings) for
// TRASH_DAYS, where they can be restored. After that the daily job deletes
// them for good. No Firebase imports, so both the browser and the server
// can use this.

export const TRASH_DAYS = 30;

export const isTrashed = (record) => !!record?.deletedAt;

// Records that should show anywhere in the app (everything not in the trash).
export const withoutTrashed = (records) => (records || []).filter(r => !isTrashed(r));

// "YYYY-MM-DD..." timestamp for when a trashed record is deleted for good.
export const purgeAtFrom = (deletedAt) => {
  const d = new Date(deletedAt);
  d.setDate(d.getDate() + TRASH_DAYS);
  return d.toISOString();
};

export const daysLeftInTrash = (record, now = new Date()) => {
  const purgeAt = new Date(record.purgeAt || purgeAtFrom(record.deletedAt));
  return Math.max(0, Math.ceil((purgeAt - now) / (24 * 60 * 60 * 1000)));
};

// A reminder attached to a job only shows while that job is still around.
export const reminderJobIsActive = (reminder, projects, pipelineEntries) =>
  (!reminder.projectId || projects.some(c => c.id === reminder.projectId)) &&
  (!reminder.pipelineId || pipelineEntries.some(p => p.id === reminder.pipelineId));
