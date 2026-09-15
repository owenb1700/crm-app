// Near-duplicate matching for Directory names. No Firebase imports, so the
// browser and server share one definition of "the same company/person".
//
// - Same: identical after normalizing (case, punctuation, spacing, "&" vs
//   "and", and endings like Inc / LLC / Co / Corp / "The"). These are
//   treated as one company everywhere and are never stored twice.
// - Similar: probably the same but not certain (typos, a missing word,
//   "Mike" vs "Michael"). The app asks "Did you mean…?" instead of guessing.

const COMPANY_FILLER = new Set([
  "the", "inc", "incorporated", "llc", "llp", "lp", "pllc", "pc", "co", "corp", "corporation",
  "company", "companies", "ltd", "limited", "group", "grp"
]);

export function normalizeCompanyName(name) {
  const raw = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  // Initials written with dots or spaces ("J.H." / "J H") read as "JH".
  const words = [];
  let inInitials = false;
  raw.forEach(w => {
    if (w.length === 1 && inInitials) {
      words[words.length - 1] += w;
    } else {
      words.push(w);
      inInitials = w.length === 1;
    }
  });

  const kept = words.filter(w => !COMPANY_FILLER.has(w));
  // A name that's nothing but filler words ("The Company") keeps them.
  return (kept.length ? kept : words).join(" ");
}

// Firestore document id for a company's uniqueness key.
export const companyKeyOf = (name) => normalizeCompanyName(name).replace(/ /g, "-").slice(0, 150) || "_blank";

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

export const sameCompany = (a, b) => {
  const na = normalizeCompanyName(a);
  return !!na && na === normalizeCompanyName(b);
};

// Probably the same company, but spelled differently. Works on names that
// are already normalized (see normalizeCompanyName).
function similarNormalized(na, nb) {
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ca = na.replace(/ /g, "");
  const cb = nb.replace(/ /g, "");
  if (ca === cb) return true;
  const ta = na.split(" ");
  const tb = nb.split(" ");
  // Same words except one that looks like a typo ("Mechnical"), but not a
  // different short word ("Hill" / "Mill").
  if (ta.length === tb.length) {
    const differing = ta.map((w, i) => [w, tb[i]]).filter(([x, y]) => x !== y);
    if (differing.length === 1) {
      const [x, y] = differing[0];
      if (Math.min(x.length, y.length) >= 5 && Math.abs(x.length - y.length) <= 2 && similarity(x, y) >= 0.8) return true;
    }
  } else if (Math.min(ca.length, cb.length) >= 8 && Math.abs(ca.length - cb.length) <= Math.max(ca.length, cb.length) * 0.1 && similarity(ca, cb) >= 0.9) {
    return true;
  }
  // One name is the other plus a word or two ("ABC Mechanical" /
  // "ABC Mechanical Services"), as long as the shorter one isn't generic.
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const shortChars = short.join("").length;
  return short.length >= 2 && shortChars >= 8 && long.length - short.length <= 2 && short.every(w => long.includes(w));
}

export const similarCompanyNames = (a, b) => similarNormalized(normalizeCompanyName(a), normalizeCompanyName(b));

// Existing companies with the same normalized name (should be at most one).
export const findSameCompany = (companies, name) =>
  (companies || []).find(c => sameCompany(c.name, name)) || null;

// Existing companies that are similar but not the same, best match first.
export function findSimilarCompanies(companies, name, limit = 3) {
  const n = normalizeCompanyName(name);
  if (n.length < 3) return [];
  return (companies || [])
    .filter(c => !sameCompany(c.name, name) && similarCompanyNames(c.name, name))
    .map(c => ({ company: c, score: similarity(normalizeCompanyName(c.name), n) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.company);
}

// ---------- people ----------

const NICKNAMES = [
  ["michael", "mike", "mikey", "mick"], ["robert", "rob", "bob", "bobby", "robbie"], ["william", "will", "bill", "billy", "liam"],
  ["james", "jim", "jimmy", "jamie"], ["thomas", "tom", "tommy"], ["david", "dave", "davey"], ["christopher", "chris"],
  ["daniel", "dan", "danny"], ["joseph", "joe", "joey"], ["steven", "stephen", "steve"], ["richard", "rich", "rick", "ricky", "dick"],
  ["matthew", "matt"], ["anthony", "tony"], ["andrew", "andy", "drew"], ["kenneth", "ken", "kenny"], ["jeffrey", "jeff", "geoffrey"],
  ["gregory", "greg"], ["nicholas", "nick", "nicky"], ["patrick", "pat"], ["samuel", "sam", "sammy"], ["benjamin", "ben", "benny"],
  ["joshua", "josh"], ["jonathan", "jon", "john", "johnny"], ["edward", "ed", "eddie", "ted"], ["charles", "charlie", "chuck"],
  ["timothy", "tim", "timmy"], ["ronald", "ron", "ronnie"], ["donald", "don", "donnie"], ["lawrence", "larry"], ["gerald", "jerry"],
  ["alexander", "alex"], ["zachary", "zach", "zack"], ["jacob", "jake"], ["nathan", "nathaniel", "nate"], ["frederick", "fred", "freddie"],
  ["katherine", "catherine", "kathryn", "kate", "katie", "kathy", "cathy", "kat"], ["elizabeth", "liz", "beth", "betty", "lizzie"],
  ["jennifer", "jen", "jenny"], ["susan", "sue", "susie"], ["margaret", "maggie", "meg", "peggy"], ["patricia", "patty", "trish", "tricia"],
  ["deborah", "debra", "deb", "debbie"], ["rebecca", "becky", "becca"], ["jessica", "jess", "jessie"], ["kimberly", "kim"],
  ["christine", "christina", "chris", "tina"], ["amanda", "mandy"], ["victoria", "vicky", "tori"], ["abigail", "abby"]
];
const NICK_GROUP = new Map();
NICKNAMES.forEach((group, i) => group.forEach(n => {
  if (!NICK_GROUP.has(n)) NICK_GROUP.set(n, new Set());
  NICK_GROUP.get(n).add(i);
}));

export const normalizePersonName = (name) =>
  String(name || "").toLowerCase().replace(/['’`.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export const samePerson = (a, b) => {
  const na = normalizePersonName(a);
  return !!na && na === normalizePersonName(b);
};

const sameFirstName = (a, b) => {
  if (a === b) return true;
  const ga = NICK_GROUP.get(a);
  const gb = NICK_GROUP.get(b);
  return !!ga && !!gb && [...ga].some(i => gb.has(i));
};

// Probably the same person: nickname vs full first name with the same last
// name ("Mike Smith" / "Michael Smith"), a first initial ("M. Smith"), or a
// small typo.
export function similarPersonNames(a, b) {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(" ");
  const pb = nb.split(" ");
  if (pa.length >= 2 && pb.length >= 2 && pa[pa.length - 1] === pb[pb.length - 1]) {
    const fa = pa[0];
    const fb = pb[0];
    if (sameFirstName(fa, fb)) return true;
    if ((fa.length === 1 && fb.startsWith(fa)) || (fb.length === 1 && fa.startsWith(fb))) return true;
  }
  return Math.min(na.length, nb.length) >= 6 && similarity(na, nb) >= 0.88;
}

export function findSimilarPeople(people, name, limit = 3) {
  const n = normalizePersonName(name);
  if (n.length < 3) return [];
  return (people || [])
    .filter(p => !samePerson(p.name, name) && similarPersonNames(p.name, name))
    .slice(0, limit);
}

// ---------- grouping for the Find Duplicates screen ----------

// Groups records whose names match, returning only groups of 2+. Only
// compares records that share a word (or the same opening letters), so a
// directory of thousands of companies still groups instantly.
function groupBy(records, keyOf, isMatch) {
  const keys = records.map(r => keyOf(r));
  const parent = records.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  const buckets = new Map();
  keys.forEach((k, i) => {
    const hooks = new Set(k.split(" ").filter(w => w.length >= 3));
    hooks.add(`^${k.replace(/ /g, "").slice(0, 4)}`);
    hooks.forEach(h => {
      if (!buckets.has(h)) buckets.set(h, []);
      buckets.get(h).push(i);
    });
  });

  const compared = new Set();
  buckets.forEach(list => {
    if (list.length > 400) return; // a word nearly every name shares ("mechanical") says nothing
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x];
        const j = list[y];
        const pair = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (compared.has(pair)) continue;
        compared.add(pair);
        if (find(i) !== find(j) && isMatch(keys[i], keys[j], records[i], records[j])) parent[find(i)] = find(j);
      }
    }
  });

  const groups = new Map();
  records.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  });
  return [...groups.values()].filter(g => g.length > 1);
}

export const groupSimilarCompanies = (companies) =>
  groupBy(companies, c => normalizeCompanyName(c.name), (a, b) => similarNormalized(a, b));

// People at the same company whose names look like the same person.
export const groupSimilarPeople = (people) =>
  groupBy(people, p => normalizePersonName(p.name), (a, b, pa, pb) => pa.companyId === pb.companyId && similarPersonNames(a, b));

// A stable id for a group, used to remember "these aren't duplicates".
export const groupIdOf = (records) => records.map(r => r.id).sort().join("|");
