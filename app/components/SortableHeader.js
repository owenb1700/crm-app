"use client";

import { nextSort, sortArrow } from "../../lib/sorting";

// A column heading you can click to sort by. The arrow shows which column
// is sorting and which way.
export default function SortableHeader({ label, columnKey, kind = "text", sort, onSort }) {
  const active = sort?.key === columnKey;
  return (
    <th
      className={`sortable-header ${active ? "is-sorted" : ""}`}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => onSort(nextSort(sort, columnKey, kind))}>
        {label}{sortArrow(sort, columnKey)}
      </button>
    </th>
  );
}
