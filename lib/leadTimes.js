// Lead times: how long after the order is placed the equipment leaves the
// factory, and when it should land on site after that.
//
// One lead time per job, not per piece. Equipment on a job ships together
// almost every time, so the number that matters is the longest item's --
// the job is only as early as the piece that comes last.
//
// Everything is counted in BUSINESS DAYS. Factories and freight don't run
// on weekends, so a Friday order with a 6-day lead time is not ready the
// following Thursday. A lead time given in weeks stays written in weeks
// and counts as 5 business days each.
//
// A range is allowed ("3-4 weeks") because that's how factories quote.
// The estimate uses the middle of the range; the range itself is kept so
// the page can still show what was actually promised.

// Freight to site, once it leaves the factory. Business days too.
export const TRANSIT_DAYS = 2;

// The units a lead time can be given in, and what each is called.
// Stored as plain words inside the lead time string ("3-4 weeks"), so a
// value typed before this was a dropdown still reads correctly.
export const LEAD_TIME_UNITS = [
  { value: "days", label: "Business days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" }
];

// The boxes <-> the stored string. "3-4 weeks" <-> { low: 3, high: 4,
// unit: "weeks" }. A blank second box means an exact figure, not a range.
export function leadTimeParts(text, { defaultUnit = "weeks" } = {}) {
  const raw = String(text || "").trim();
  const range = raw.match(RANGE);
  const single = range ? null : raw.match(SINGLE);
  if (!range && !single) return { low: "", high: "", unit: defaultUnit };
  const unitWord = (range ? range[3] : single[2]).toLowerCase();
  // An abbreviation ("wks") has to land on the dropdown's own word, or the
  // select would show nothing selected. Match on what the unit is worth.
  const CANONICAL = { 1: "days", 5: "weeks", 22: "months" };
  const unit = CANONICAL[UNITS[unitWord]] || defaultUnit;
  return range
    ? { low: range[1], high: range[2], unit }
    : { low: single[1], high: "", unit };
}

export function formatLeadTime({ low, high, unit }) {
  const a = String(low ?? "").trim();
  const b = String(high ?? "").trim();
  if (!a) return "";
  const word = LEAD_TIME_UNITS.some(u => u.value === unit) ? unit : "weeks";
  return b && b !== a ? `${a}-${b} ${word}` : `${a} ${word}`;
}

// What a lead time is assumed to be when nobody has given one.
export const DEFAULT_LEAD_TIME_DAYS = 6;
export const DEFAULT_LEAD_TIME_TEXT = "6 days";

// Business days per unit.
const UNITS = {
  d: 1, day: 1, days: 1,
  w: 5, wk: 5, wks: 5, week: 5, weeks: 5,
  m: 22, mo: 22, mos: 22, month: 22, months: 22
};

const NUM = "(\\d+(?:\\.\\d+)?)";
const RANGE = new RegExp(`^\\s*${NUM}\\s*(?:-|–|—|to|thru|through)\\s*${NUM}\\s*([a-z]*)\\.?\\s*$`, "i");
const SINGLE = new RegExp(`^\\s*${NUM}\\s*([a-z]*)\\.?\\s*$`, "i");

// "3-4 weeks" -> { low: 15, high: 20, days: 18, ... }, all business days.
// Returns null for anything that isn't a lead time, so a blank field is
// simply no lead time rather than an error.
//
// `defaultUnit` covers a bare number: equipment is quoted in weeks, parts
// in days, and each caller says which it means. Whatever is assumed gets
// echoed back so nobody has to guess how "10" was read.
export function parseLeadTime(text, { defaultUnit = "weeks" } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const range = raw.match(RANGE);
  const single = range ? null : raw.match(SINGLE);
  if (!range && !single) return null;

  const unitWord = (range ? range[3] : single[2]).toLowerCase();
  const perUnit = UNITS[unitWord] ?? (unitWord ? null : UNITS[defaultUnit]);
  if (!perUnit) return null; // a unit we don't know -- don't guess at it

  const lowValue = Number(range ? range[1] : single[1]);
  const highValue = Number(range ? range[2] : single[1]);
  if (!(lowValue >= 0) || !(highValue >= 0) || highValue < lowValue) return null;

  const assumedUnit = unitWord || defaultUnit;
  const plural = highValue === 1 ? assumedUnit.replace(/s$/, "") : assumedUnit;
  const low = Math.round(lowValue * perUnit);
  const high = Math.round(highValue * perUnit);

  return {
    low,
    high,
    // The middle of the range is what every date is figured from.
    days: Math.round((low + high) / 2),
    isRange: low !== high,
    inWeeks: perUnit === 5,
    assumedUnit: unitWord ? "" : defaultUnit, // set only when we filled it in
    label: range ? `${lowValue}-${highValue} ${plural}` : `${lowValue} ${plural}`,
    text: raw
  };
}

// Everything here works in Central time's calendar date, the same way
// reminder dates do, so the browser and the nightly digest job never
// disagree about which day "today" is.
export const todayKey = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

const isWeekend = (dt) => dt.getUTCDay() === 0 || dt.getUTCDay() === 6;

const toUTC = (day) => {
  const [y, m, d] = String(day || "").slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};

const iso = (dt) => dt.toISOString().slice(0, 10);

// A weekend start rolls forward to Monday -- an order placed Saturday is
// really an order the factory sees Monday.
export function nextBusinessDay(day) {
  const dt = toUTC(day);
  if (!dt) return "";
  while (isWeekend(dt)) dt.setUTCDate(dt.getUTCDate() + 1);
  return iso(dt);
}

// `count` business days after `day`, skipping Saturdays and Sundays.
export function addBusinessDays(day, count) {
  const dt = toUTC(day);
  if (!dt) return "";
  while (isWeekend(dt)) dt.setUTCDate(dt.getUTCDate() + 1);
  let left = Math.max(0, Math.round(count));
  while (left > 0) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    if (!isWeekend(dt)) left -= 1;
  }
  return iso(dt);
}

// Whole business days from `from` to `to`; negative if `to` is earlier.
export function businessDaysBetween(from, to) {
  const a = toUTC(from);
  const b = toUTC(to);
  if (!a || !b) return null;
  const backwards = b < a;
  const start = backwards ? b : a;
  const end = backwards ? a : b;
  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor)) count += 1;
  }
  return backwards ? -count : count;
}

// What a job's dates look like right now. `today` is passed in rather than
// read from the clock so the digest job (Central time) and the browser
// agree on which day it is.
//
// states:
//   quoted        lead time on file, nothing ordered yet -- shows what it
//                 would ship if the order went in today
//   on-track      ordered, still inside the lead time
//   ship-due      ordered, today is the day it was supposed to ship
//   ship-late     that day has passed and nobody has marked it shipped
//   in-transit    shipped, still inside the two-day ride
//   delivery-due  shipped, should have landed by now
//   delivered     someone confirmed it arrived
export function leadTimeStatus(record, today, { defaultUnit = "weeks" } = {}) {
  const given = parseLeadTime(record?.leadTime, { defaultUnit });
  // No lead time on file falls back to the house default rather than
  // tracking nothing -- but only once there's an order to count from, and
  // the page always says the number was assumed.
  const orderedOn = String(record?.orderedOn || "").slice(0, 10);
  const parsed = given || (orderedOn ? {
    ...parseLeadTime(DEFAULT_LEAD_TIME_TEXT, { defaultUnit: "days" }),
    isDefault: true
  } : null);
  if (!parsed) return { state: "none", parsed: null };

  const shippedOn = String(record?.shippedOn || "").slice(0, 10);
  const deliveredOn = String(record?.deliveredOn || "").slice(0, 10);
  const now = String(today || "").slice(0, 10);

  if (deliveredOn) {
    return { state: "delivered", parsed, orderedOn, shippedOn, deliveredOn };
  }

  if (shippedOn) {
    const dueOn = addBusinessDays(shippedOn, TRANSIT_DAYS);
    const late = businessDaysBetween(dueOn, now);
    return {
      state: late >= 0 ? "delivery-due" : "in-transit",
      parsed, orderedOn, shippedOn,
      deliveryDate: dueOn,
      daysLate: Math.max(0, late ?? 0)
    };
  }

  if (!orderedOn) {
    // Nothing ordered yet: the ship date is only ever "if it went in today".
    return { state: "quoted", parsed, shipDate: now ? addBusinessDays(now, parsed.days) : "", provisional: true };
  }

  const shipDate = addBusinessDays(orderedOn, parsed.days);
  const late = businessDaysBetween(shipDate, now);
  return {
    state: late > 0 ? "ship-late" : late === 0 ? "ship-due" : "on-track",
    parsed, orderedOn, shipDate,
    daysLate: Math.max(0, late ?? 0),
    deliveryDate: addBusinessDays(shipDate, TRANSIT_DAYS)
  };
}

// The states that are worth putting in front of someone.
export const LEAD_TIME_ALERT_STATES = ["ship-due", "ship-late", "delivery-due"];
export const isLeadTimeAlert = (status) => LEAD_TIME_ALERT_STATES.includes(status?.state);

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
const workDays = (n) => plural(n, "business day");

// "3-4 weeks", plus "(assumed)" when nobody actually gave one.
const leadLabel = (parsed) => `${parsed.label}${parsed.isDefault ? " (assumed)" : ""}`;

// One line of plain English for the card, the alert list and the digest.
export function describeLeadTime(status, { subject = "This" } = {}) {
  if (!status || status.state === "none") return "";
  switch (status.state) {
    case "quoted":
      return `${leadLabel(status.parsed)} lead time — ordered today, ships about ${status.shipDate}`;
    case "on-track":
      return `Ships about ${status.shipDate} (${leadLabel(status.parsed)} from ${status.orderedOn})`;
    case "ship-due":
      return `${subject} was due to ship today (${status.shipDate})`;
    case "ship-late":
      return `${subject} was due to ship ${status.shipDate} — ${workDays(status.daysLate)} ago, not marked shipped`;
    case "in-transit":
      return `Shipped ${status.shippedOn} — should arrive about ${status.deliveryDate}`;
    case "delivery-due":
      return status.daysLate > 0
        ? `Should have arrived ${status.deliveryDate} — ${workDays(status.daysLate)} ago`
        : `Should arrive today (${status.deliveryDate})`;
    case "delivered":
      return `Delivered ${status.deliveredOn}`;
    default:
      return "";
  }
}

// What the alert lists sort and filter on: the date the alert is about.
export const leadTimeAlertDate = (status) =>
  status?.state === "delivery-due" ? status.deliveryDate : status?.shipDate || "";
