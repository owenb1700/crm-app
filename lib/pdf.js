import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

// jsPDF's built-in fonts only cover Western (Windows-1252) characters, so
// punctuation outside that set is swapped for the closest plain character
// and emoji are dropped -- otherwise they print as garbage.
const pdfText = (value) => String(value)
  .replace(/[—–]/g, "-")
  .replace(/·/g, "|")
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/…/g, "...")
  .replace(/[←-⇿☀-➿\u{1F000}-\u{1FAFF}️]/gu, "")
  .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, "");

const cellText = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("en-US");
  return pdfText(value);
};

// A landscape Letter PDF of one table: title, export date, a navy header
// row repeated on every page, light row striping, and page numbers.
export function buildPdf({ title, headers, rows }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const exportedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Numeric columns right-align so digits line up.
  const numericColumns = headers
    .map((_, i) => rows.length > 0 && rows.every(r => r[i] === "" || r[i] === null || r[i] === undefined || typeof r[i] === "number") && rows.some(r => typeof r[i] === "number"))
    .reduce((acc, isNum, i) => (isNum ? { ...acc, [i]: { halign: "right" } } : acc), {});

  autoTable(doc, {
    head: [headers.map(cellText)],
    body: rows.length ? rows.map(r => headers.map((_, i) => cellText(r[i]))) : [[{ content: "No rows to show.", colSpan: headers.length }]],
    startY: margin + 34,
    margin: { top: margin + 34, left: margin, right: margin, bottom: margin + 10 },
    theme: "grid",
    // minCellWidth keeps short columns (names, dates, counts) readable
    // when a long notes column would otherwise squeeze them.
    styles: { font: "helvetica", fontSize: 8, cellPadding: 4, overflow: "linebreak", minCellWidth: 64, lineColor: [226, 230, 236], lineWidth: 0.5, textColor: [26, 34, 51] },
    headStyles: { fillColor: [13, 20, 36], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 251] },
    columnStyles: numericColumns,
    didDrawPage: () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(26, 34, 51);
      doc.text(pdfText(title), margin, margin + 6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(107, 114, 128);
      doc.text(`Bullock Logan CRM  |  Exported ${exportedOn}  |  ${rows.length} ${rows.length === 1 ? "row" : "rows"}`, margin, margin + 20);
      doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - margin, pageHeight - margin + 14, { align: "right" });
    }
  });

  return doc;
}

export function downloadPdf({ filename, ...table }) {
  buildPdf(table).save(`${filename}.pdf`);
}
