import { buildXlsx } from "./xlsx";

// Builds a CSV file in the browser and downloads it. Values are quoted so
// commas, quotes, and line breaks inside a field survive, and a leading
// = + - @ is prefixed with ' so spreadsheet apps don't run it as a formula.
const cell = (value) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows].map(row => row.map(cell).join(","));
  // BOM so Excel opens UTF-8 names (é, ñ) correctly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  saveBlob(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

// Every export in the app goes through this, so CSV and Excel always
// contain exactly the same rows and columns. `sheetName` is the Excel tab
// name; it defaults to a readable version of the filename.
export function downloadTable({ filename, headers, rows, format = "csv", sheetName }) {
  if (format === "xlsx") {
    const name = sheetName || filename.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    saveBlob(buildXlsx({ sheetName: name, headers, rows }), `${filename}.xlsx`);
  } else {
    downloadCsv(filename, headers, rows);
  }
}

export const csvDateStamp = () => new Date().toISOString().slice(0, 10);
