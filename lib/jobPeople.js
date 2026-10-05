import { normalizeSplits } from "./splits";
import { personName } from "./people";

// Everyone with a stake in one job, for "who should know about this note?".
//
// Deliberately wider than the list that gets chased about a job. Being on
// the hook for a bid and wanting to hear what was said on a call are not
// the same thing, and the person writing the note is the one who decides
// -- this only has to offer them the right names.
//
// Each person comes back with the reason they are on the list, because
// "Rob B" on its own is a worse question than "Rob B -- salesperson".

const add = (into, id, why) => {
  if (!id) return;
  if (into.has(id)) return;          // the first reason is the truest one
  into.set(id, why);
};

export function jobPeopleIds(record, kind = "project") {
  const found = new Map();
  if (!record) return found;

  if (kind === "pipeline") {
    add(found, record.ownerId, "owner");
    add(found, record.salespersonId, "salesperson");
    add(found, record.projectPointPersonId, "point person");
    (record.biddingCompanies || []).forEach(b => add(found, b?.salespersonId, `rep on ${b?.company || "a bidding firm"}`));
    (record.trackedByIds || []).forEach(id => add(found, id, "added it to their list"));
  } else {
    add(found, record.ownerId, "owner");
    (record.collaboratorIds || []).forEach(id => add(found, id, "collaborator"));
    add(found, record.enteredBy, "entered it");
  }

  normalizeSplits(record.splits).forEach(s => add(found, s.userId, "has a share of it"));
  return found;
}

// The same list as people, ready to show: name, reason, no duplicates, and
// never you -- writing a note doesn't need telling you wrote it. Anyone
// whose account is gone or switched off is dropped, since a notification
// nobody can read is just a row in a table.
export function jobPeople(record, { kind = "project", users = [], exclude } = {}) {
  return [...jobPeopleIds(record, kind)]
    .filter(([id]) => id !== exclude)
    .map(([id, why]) => {
      const user = (users || []).find(u => u.id === id);
      return user && !user.disabled ? { id, why, name: personName(user) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// What the note's alert says. The job's name matters more than the words
// of the note -- the note is one click away and may be long.
export const noteAlertMessage = (authorName, title) =>
  `${authorName || "Someone"} added a note on "${title || "a job"}"`;
