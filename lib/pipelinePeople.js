import { hasShare } from "./splits";

// Who a pipeline entry's reminder goes to: the salesperson it's assigned
// to, the project point person, whoever owns the entry, and the
// salespeople assigned to the firms bidding it. Trackers and credit-split
// holders are deliberately left out -- the list is who is on the hook for
// the job, not everyone watching it.
export function pipelineTeamIds(pipeline) {
  if (!pipeline) return [];
  const ids = [
    pipeline.ownerId,
    pipeline.salespersonId,
    pipeline.projectPointPersonId,
    ...(pipeline.biddingCompanies || []).map(b => b?.salespersonId)
  ].filter(Boolean);
  return [...new Set(ids)];
}

export const remindableTeam = (pipeline, users) =>
  pipelineTeamIds(pipeline)
    .map(id => (users || []).find(u => u.id === id))
    .filter(u => u && !u.disabled);

export const describeTeam = (people, nameOf) => {
  const names = people.map(nameOf).filter(Boolean);
  if (names.length === 0) return "nobody else";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

// ---- is this entry on my list, and why ----
//
// An entry reaches My Projects five ways: you own it, you're its
// salesperson or point person, you have a share of it, or you added it.
// The Add To My Projects button only ever looked at the last of those, so
// on your own entry it offered to add something that was already there --
// and pressing Remove cleared the tracking without taking it off the
// list, because ownership was what put it there.

export const isTrackingPipeline = (entry, uid) =>
  !!uid && (entry?.trackedByIds || []).includes(uid);

// On my list for a reason other than having added it -- which is a reason
// that can't be undone from a button.
export const isMinePipelineByRole = (entry, uid) =>
  !!uid && !!entry && (
    entry.ownerId === uid ||
    entry.salespersonId === uid ||
    entry.projectPointPersonId === uid ||
    hasShare(entry, uid)
  );

export const isOnMyPipelineList = (entry, uid) =>
  isMinePipelineByRole(entry, uid) || isTrackingPipeline(entry, uid);

// What the button should offer: "add" when it isn't on the list, "remove"
// when the only thing keeping it there is that you added it, and nothing
// at all when it is yours anyway.
export function pipelineListAction(entry, uid) {
  if (isMinePipelineByRole(entry, uid)) return "none";
  return isTrackingPipeline(entry, uid) ? "remove" : "add";
}
