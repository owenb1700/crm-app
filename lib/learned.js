// What the database already knows, offered back so nobody types the same
// thing twice.
//
// Every function here returns a *suggestion*, never a value on its own:
// { value, source } where source is a plain sentence saying where it came
// from ("from the job here in March 2026"). Nothing is ever filled in
// silently -- a suggestion the user can't trace is a suggestion they
// can't check, and a wrong one would spread through every job that
// followed.
//
// Nothing here writes anything. The forms decide what to do with a
// suggestion; this only remembers.

import { sameAddress } from "./addresses";
import { sameCompany } from "./companyMatch";
import { equipmentRowsFrom } from "./equipment";
import { OWNER_CATEGORY } from "./directory";

const clean = (v) => String(v ?? "").trim();

export const suggestion = (value, source) => {
  const hasValue = Array.isArray(value) ? value.length > 0 : clean(value) !== "";
  return hasValue ? { value, source } : null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// "March 2026" from whatever shape the date is in. Undated records just
// say so rather than guessing.
export function whenish(value) {
  const text = clean(value?.seconds ? new Date(value.seconds * 1000).toISOString() : value);
  const m = text.match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const dateOf = (r) =>
  clean(r.nextCheckIn || r.bidDate || r.neededBy || r.createdAt || "");

// Newest first, so the most recent answer is the one offered.
const newestFirst = (rows) => [...rows].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));

const describe = (record, kind) => {
  const when = whenish(dateOf(record));
  const name = clean(record.projectName || record.title || record.item) || `this ${kind}`;
  return when ? `from ${name}, ${when}` : `from ${name}`;
};

// ---------- 1. what we know about a building ----------

// A building's own facts: who looks after it, and what's on the roof.
//
// Only the building engineer / owner is offered. Engineering firms are
// deliberately left out: plenty of them may have worked here over the
// years, and defaulting one would be a guess dressed up as a record.
export function buildingMemory({ address, projects = [], pipeline = [], parts = [] }) {
  if (!clean(address)) return { engineers: [], equipment: [], source: "" };

  const here = (r) => sameAddress(r.projectAddress, address);
  const jobs = newestFirst(projects.filter(here));
  const bids = newestFirst(pipeline.filter(here));
  const orders = newestFirst(parts.filter(here));
  const any = [...jobs, ...bids, ...orders];
  if (!any.length) return { engineers: [], equipment: [], source: "" };

  // The people who look after the building, newest mention first.
  const engineers = [];
  for (const job of [...jobs, ...bids]) {
    for (const row of job.owners || []) {
      const company = clean(row.company);
      const contact = clean(row.contact);
      if (!company && !contact) continue;
      if (engineers.some(e => sameCompany(e.company, company) && e.contact === contact)) continue;
      engineers.push({
        company, contact, email: clean(row.email), phone: clean(row.phone),
        source: describe(job, job.title ? "pipeline entry" : "project")
      });
    }
  }

  // Equipment doesn't move. Anything logged here before is still here.
  const equipment = [];
  for (const job of jobs) {
    for (const row of equipmentRowsFrom(job)) {
      if (!row.serial && !row.model && !row.manufacturer) continue;
      const already = equipment.some(e =>
        (row.serial && e.serial && e.serial.toLowerCase() === row.serial.toLowerCase()) ||
        (!row.serial && e.model === row.model && e.manufacturer === row.manufacturer));
      if (already) continue;
      equipment.push({ ...row, source: describe(job, "project") });
    }
  }

  return { engineers, equipment, source: describe(any[0], "job") };
}

// ---------- 2. a serial number knows its own machine ----------

// A serial is unique and permanent, so it should only ever be typed once.
export function equipmentBySerial(serial, projects = []) {
  const needle = clean(serial).toLowerCase();
  if (!needle) return null;

  // Facts about one machine accumulate across every job it has appeared
  // on. The newest job wins where they disagree, but a blank on the newest
  // is filled from an older one -- somebody leaving the install year off
  // last time shouldn't lose the year we already knew.
  const known = { type: "", manufacturer: "", model: "", yearInstalled: "" };
  let from = null;
  let where = "";

  for (const job of newestFirst(projects)) {
    for (const row of equipmentRowsFrom(job)) {
      if (clean(row.serial).toLowerCase() !== needle) continue;
      for (const field of Object.keys(known)) {
        if (!known[field] && clean(row[field])) known[field] = clean(row[field]);
      }
      if (!from) { from = job; where = clean(job.projectAddress); }
    }
  }

  if (!from || !Object.values(known).some(Boolean)) return null;
  return suggestion(known, `${describe(from, "project")}${where ? ` at ${where}` : ""}`);
}

// ---------- 3. a model number knows its maker ----------

export function modelMemory({ manufacturer, model }, towerModels = [], projects = []) {
  const wanted = clean(model).toLowerCase();
  if (!wanted) return null;

  const record = (towerModels || []).find(t => clean(t.model).toLowerCase() === wanted);
  if (record) {
    return suggestion(
      {
        manufacturer: clean(record.manufacturer) || clean(manufacturer),
        drawings: (record.drawings || []).length
      },
      `from the Tower Models record for ${clean(record.model)}`
    );
  }

  // Not a model record yet, but it may have been typed on a job before.
  for (const job of newestFirst(projects)) {
    for (const row of equipmentRowsFrom(job)) {
      if (clean(row.model).toLowerCase() !== wanted) continue;
      if (!clean(row.manufacturer) && !clean(row.type)) continue;
      return suggestion(
        { manufacturer: clean(row.manufacturer), type: clean(row.type), drawings: 0 },
        describe(job, "project")
      );
    }
  }
  return null;
}

// ---------- 4. whose firm is this, usually ----------

// The salesperson a firm's work usually belongs to. Offered as a default,
// never locked -- plenty of jobs are somebody else's.
export function salespersonForFirm(firmName, { projects = [], pipeline = [], nameOf = (id) => id } = {}) {
  const firm = clean(firmName);
  if (!firm) return null;

  const counts = new Map();
  const mine = [...projects, ...pipeline].filter(r => sameCompany(r.company, firm) && clean(r.ownerId));
  for (const r of mine) counts.set(r.ownerId, (counts.get(r.ownerId) || 0) + 1);
  if (!counts.size) return null;

  const [best, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const total = mine.length;
  return suggestion(
    best,
    `${nameOf(best)} has ${count === total ? "every" : `${count} of ${total}`} ${total === 1 ? "job" : "jobs"} for ${firm}`
  );
}

// ---------- 6. an email address knows its company ----------

// Free providers say nothing about where somebody works.
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "me.com", "comcast.net", "sbcglobal.net", "att.net", "msn.com", "live.com"
]);

export const domainOf = (email) => {
  const at = clean(email).toLowerCase().split("@");
  return at.length === 2 && at[1].includes(".") ? at[1] : "";
};

// Which firm an email address points at, learned from the addresses
// already on file rather than from guessing at the company name.
export function firmFromEmail(email, { contacts = [], companies = [] } = {}) {
  const domain = domainOf(email);
  if (!domain || PUBLIC_DOMAINS.has(domain)) return null;

  const counts = new Map();
  for (const person of contacts) {
    const addresses = person.emails || (person.email ? [person.email] : []);
    if (!addresses.some(a => domainOf(a) === domain)) continue;
    const firm = clean(person.companyName);
    if (firm) counts.set(firm, (counts.get(firm) || 0) + 1);
  }

  if (counts.size) {
    const [firm, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return suggestion(firm, `${count} other ${count === 1 ? "person" : "people"} at ${domain}`);
  }

  // Nobody on file yet, but the firm's own website may say it.
  const byWebsite = (companies || []).find(c => clean(c.website).toLowerCase().includes(domain));
  return byWebsite ? suggestion(clean(byWebsite.name), `${domain} is ${clean(byWebsite.name)}'s website`) : null;
}

// Says so when an email doesn't match the firm that's been picked -- which
// catches a typo, or somebody who has changed jobs.
export function emailFirmMismatch(email, firmName, { contacts = [] } = {}) {
  const guess = firmFromEmail(email, { contacts });
  if (!guess || !clean(firmName)) return null;
  if (sameCompany(guess.value, firmName)) return null;
  return { expected: guess.value, source: guess.source };
}

// ---------- 7 & 8. a person knows their firm and their title ----------

const findPersonNamed = (contacts, name) => {
  const needle = clean(name).toLowerCase();
  if (!needle) return null;
  return (contacts || []).find(c => clean(c.name).toLowerCase() === needle) || null;
};

export function firmForPerson(name, { contacts = [] } = {}) {
  const person = findPersonNamed(contacts, name);
  const firm = clean(person?.companyName);
  return firm ? suggestion(firm, `${clean(person.name)} is on file at ${firm}`) : null;
}

export function titleForPerson(name, { contacts = [] } = {}) {
  const person = findPersonNamed(contacts, name);
  const title = clean(person?.title);
  return title ? suggestion(title, `${clean(person.name)}'s title on file`) : null;
}
