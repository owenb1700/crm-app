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
