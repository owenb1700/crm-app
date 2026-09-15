// Builds a CSV file in the browser and downloads it. Values are quoted so
// commas, quotes, and line breaks inside a field survive, and a leading
// = + - @ is prefixed with ' so spreadsheet apps don't run it as a formula.
const cell = (value) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows].map(row => row.map(cell).join(","));
  // BOM so Excel opens UTF-8 names (é, ñ) correctly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvDateStamp = () => new Date().toISOString().slice(0, 10);
