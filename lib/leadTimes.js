// Lead times: how long after the order is placed the equipment leaves the
// factory, and when it should land on site after that.
//
// One lead time per job, not per piece. Equipment on a job ships together
// almost every time, so the number that matters is the longest item's --
// the job is only as early as the piece that comes last.
//
// A range is allowed ("14-16 weeks") because that's how factories quote.
// The estimate uses the middle of the range; the range itself is kept so
// the page can still show what was actually promised.

// Freight to site, once it leaves the factory.
export const TRANSIT_DAYS = 2;

const UNITS = {
  d: 1, day: 1, days: 1,
  w: 7, wk: 7, wks: 7, week: 7, weeks: 7,
  m: 30, mo: 30, mos: 30, month: 30, months: 30
};

const NUM = "(\\d+(?:\\.\\d+)?)";
const RANGE = new RegExp(`^\\s*${NUM}\\s*(?:-|–|—|to|thru|through)\\s*${NUM}\\s*([a-z]*)\\.?\\s*$`, "i");
const SINGLE = new RegExp(`^\\s*${NUM}\\s*([a-z]*)\\.?\\s*$`, "i");

// "14-16 weeks" -> { low: 98, high: 112, days: 105, ... }. Returns null for
// anything that isn't a lead time, so a blank field is simply no lead time
// rather than an error.
//
// `defaultUnit` covers a bare number: equipment is quoted in weeks, parts
// in days, and each caller says which it means. Whatever is assumed gets
// echoed back in `label` so nobody has to guess how "10" was read.
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

// Calendar days, not business days -- factories quote calendar weeks, and
// a truck runs on Saturday.
export function addDays(day, count) {
  const iso = String(day || "").slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + count);
  return dt.toISOString().slice(0, 10);
}

export const daysBetween = (from, to) => {
  const a = String(from || "").slice(0, 10);
  const b = String(to || "").slice(0, 10);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
};

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
  const parsed = parseLeadTime(record?.leadTime, { defaultUnit });
  if (!parsed) return { state: "none", parsed: null };

  const orderedOn = String(record?.orderedOn || "").slice(0, 10);
  const shippedOn = String(record?.shippedOn || "").slice(0, 10);
  const deliveredOn = String(record?.deliveredOn || "").slice(0, 10);
  const now = String(today || "").slice(0, 10);

  if (deliveredOn) {
    return { state: "delivered", parsed, orderedOn, shippedOn, deliveredOn };
  }

  if (shippedOn) {
    const dueOn = addDays(shippedOn, TRANSIT_DAYS);
    return {
      state: daysBetween(dueOn, now) >= 0 ? "delivery-due" : "in-transit",
      parsed, orderedOn, shippedOn,
      deliveryDate: dueOn,
      daysLate: Math.max(0, daysBetween(dueOn, now) ?? 0)
    };
  }

  if (!orderedOn) {
    // Nothing ordered yet: the ship date is only ever "if it went in today".
    return { state: "quoted", parsed, shipDate: now ? addDays(now, parsed.days) : "", provisional: true };
  }

  const shipDate = addDays(orderedOn, parsed.days);
  const late = daysBetween(shipDate, now);
  return {
    state: late > 0 ? "ship-late" : late === 0 ? "ship-due" : "on-track",
    parsed, orderedOn, shipDate,
    daysLate: Math.max(0, late ?? 0),
    deliveryDate: addDays(shipDate, TRANSIT_DAYS)
  };
}

// The states that are worth putting in front of someone.
export const LEAD_TIME_ALERT_STATES = ["ship-due", "ship-late", "delivery-due"];
export const isLeadTimeAlert = (status) => LEAD_TIME_ALERT_STATES.includes(status?.state);

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

// One line of plain English for the card, the alert list and the digest.
export function describeLeadTime(status, { subject = "This" } = {}) {
  if (!status || status.state === "none") return "";
  switch (status.state) {
    case "quoted":
      return `${status.parsed.label} lead time — ordered today, ships about ${status.shipDate}`;
    case "on-track":
      return `Ships about ${status.shipDate} (${status.parsed.label} from ${status.orderedOn})`;
    case "ship-due":
      return `${subject} was due to ship today (${status.shipDate})`;
    case "ship-late":
      return `${subject} was due to ship ${status.shipDate} — ${plural(status.daysLate, "day")} ago, not marked shipped`;
    case "in-transit":
      return `Shipped ${status.shippedOn} — should arrive about ${status.deliveryDate}`;
    case "delivery-due":
      return status.daysLate > 0
        ? `Should have arrived ${status.deliveryDate} — ${plural(status.daysLate, "day")} ago`
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
