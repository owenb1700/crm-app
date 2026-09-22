import { parseMoney } from "./analytics";

// Sorting for the lists and tables. One comparator so "by value" means the
// same thing everywhere -- "450k" sorts above "$99,000" because both are
// read as amounts, and a blank always sinks to the bottom rather than
// pretending to be zero.

const day = (v) => (v?.seconds ? new Date(v.seconds * 1000).toISOString().slice(0, 10) : String(v || "").slice(0, 10));

const EMPTY_LAST = "￿"; // sorts after anything real

export const sortValues = {
  text: (v) => (String(v ?? "").trim().toLowerCase() || EMPTY_LAST),
  date: (v) => (day(v) || EMPTY_LAST),
  money: (v) => {
    const n = parseMoney(v);
    return n === null ? null : n;
  }
};

// direction: "asc" | "desc". Blanks stay last either way -- flipping the
// direction shouldn't fill the top of the list with empties.
export function compareBy(kind, a, b, direction = "asc") {
  const read = sortValues[kind] || sortValues.text;
  const left = read(a);
  const right = read(b);

  if (kind === "money") {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return direction === "asc" ? left - right : right - left;
  }

  const leftEmpty = left === EMPTY_LAST;
  const rightEmpty = right === EMPTY_LAST;
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
}

// `columns` maps a key to { kind, get }. Returns a new sorted array.
export function sortRows(rows, columns, sort) {
  if (!sort?.key || !columns?.[sort.key]) return [...(rows || [])];
  const { kind = "text", get } = columns[sort.key];
  return [...(rows || [])].sort((a, b) => compareBy(kind, get(a), get(b), sort.direction));
}

// Clicking a column: same column flips direction, a new column starts
// ascending (or newest-first for dates, which is what people expect).
export function nextSort(current, key, kind = "text") {
  if (current?.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: kind === "date" || kind === "money" ? "desc" : "asc" };
}

export const sortArrow = (sort, key) => (sort?.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : "");
