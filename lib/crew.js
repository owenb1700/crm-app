// Who is actually on a job, by name.
//
// Not accounts, not logins, not people with permissions -- just names an
// admin keeps a list of, so a day's crew can be written down and a
// salesperson can see who is on their job. Nobody here ever signs in.
//
// A day can also name somebody who isn't on the list at all: outside
// labour gets hired for a week and there's no sense making an admin add
// them first. Those names are stored on the day exactly as typed and
// never touch the list.

export const CREW_COLLECTION = "crew";

// What someone is on the job. Foreman and Labor cover nearly everyone;
// anything else gets typed in, because trades and one-off roles come up
// and waiting on a code change to record one is silly.
export const COMMON_CREW_TITLES = ["Foreman", "Labor"];

export const blankCrewMember = () => ({ name: "", title: "" });

export const crewTitle = (c) => String(c?.title || "").trim();

// Every title in use, the standing two first and anything typed after,
// so the picker offers what this company actually calls people.
export function crewTitles(crew) {
  const typed = [...new Set((crew || []).map(crewTitle).filter(Boolean))]
    .filter(t => !COMMON_CREW_TITLES.some(c => c.toLowerCase() === t.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  return [...COMMON_CREW_TITLES, ...typed];
}

// "Dan Helm (Foreman)" -- the title only shows when there is one.
export const crewLabel = (c) => {
  const name = crewName(c);
  const title = crewTitle(c);
  return title ? `${name} (${title})` : name;
};

// The title for a name, looked up on the list. Outside labour typed onto
// a day isn't on the list and has none.
export const titleOf = (name, crew) =>
  crewTitle((crew || []).find(c => sameCrewName(crewName(c), name)));

export const crewName = (c) => String(c?.name || "").trim();

// Two spellings of one person shouldn't both sit in the list.
export const sameCrewName = (a, b) =>
  crewName({ name: a }).toLowerCase() === crewName({ name: b }).toLowerCase();

export const crewForStorage = (member) => ({
  name: crewName(member),
  title: crewTitle(member)
});

export const crewError = (member, existing = []) => {
  const name = crewName(member);
  if (!name) return "Give the person a name.";
  if (existing.some(c => sameCrewName(crewName(c), name))) return `${name} is already on the list.`;
  return "";
};

// Active names, sorted, for the pickers.
export const crewNames = (crew) =>
  [...new Set((crew || []).filter(c => !c.archived).map(crewName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

// ---- the people named on a single day of work ----

export const peopleOn = (day) => (day?.people || []).map(n => String(n || "").trim()).filter(Boolean);

// Names are stored trimmed, de-duplicated and in the order they were
// added, so a day reads the same way twice.
export function peopleForStorage(names) {
  const seen = new Set();
  return (names || [])
    .map(n => String(n || "").trim())
    .filter(Boolean)
    .filter(n => {
      const key = n.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// You can't have four people named on a three-man day. The count is what
// the capacity warning reads, so it follows the names up but never down --
// naming two of five shouldn't quietly shrink the day.
export const menFor = (day) => Math.max(Number(day?.men) || 0, peopleOn(day).length);

// "Dan Helm, Mike R and 2 more"
export function describePeople(day, limit = 3) {
  const names = peopleOn(day);
  if (!names.length) return "";
  if (names.length <= limit) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

// Everyone named across a whole schedule, for the project page and the
// day popup -- who worked this job, rather than who worked Tuesday.
export function everyoneOn(record) {
  const all = (record?.laborSchedule?.days || []).flatMap(peopleOn);
  return [...new Set(all.map(n => n.trim()))].sort((a, b) => a.localeCompare(b));
}

// Which of a day's names aren't on the admin's list -- outside labour,
// shown as such so nobody assumes the list is complete.
export const outsideNames = (day, crew) => {
  const known = new Set(crewNames(crew).map(n => n.toLowerCase()));
  return peopleOn(day).filter(n => !known.has(n.toLowerCase()));
};
