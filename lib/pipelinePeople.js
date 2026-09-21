import { normalizeSplits } from "./splits";

// Everyone working a pipeline entry: the salesperson and point person it's
// assigned to, whoever entered it, anyone tracking it, anyone holding a
// share of it, and the salespeople assigned to the firms bidding it.
//
// Used by "Remind everyone" so one alert reaches the whole group, and kept
// here so the rule is written down once.
export function pipelineTeamIds(pipeline) {
  if (!pipeline) return [];
  const ids = [
    pipeline.ownerId,
    pipeline.salespersonId,
    pipeline.projectPointPersonId,
    ...(pipeline.trackedByIds || []),
    ...normalizeSplits(pipeline.splits).map(s => s.userId),
    // A bidder's assigned salesperson is on the hook for that firm's number.
    ...(pipeline.biddingCompanies || []).map(b => b?.salespersonId)
  ].filter(Boolean);
  return [...new Set(ids)];
}

// Who a reminder would actually go to, with the people who can't receive
// one (deactivated accounts, ids with no user left) dropped.
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
