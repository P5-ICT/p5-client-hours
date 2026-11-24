import type { SheetModel } from "./excel";

/** Turns the library-free sheet description into what the Excel writer expects. */
export function toWriterSheets(models: SheetModel[]) {
  return models.map((m) => ({
    sheet: m.name,
    columns: m.widths.map((width) => ({ width })),
    data: m.rows.map((row) =>
      row.map((c) => (c.value === null ? null : { value: c.value, fontWeight: c.fontWeight, format: c.format, wrap: c.wrap })),
    ),
  }));
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The Excel writer is loaded only when someone presses Download, so it does not weigh down the other pages. */
export async function downloadXlsx(models: SheetModel[], fileName: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(toWriterSheets(models)).toBlob();
  saveBlob(blob, fileName);
}

export function downloadText(text: string, fileName: string, type = "text/csv") {
  saveBlob(new Blob([text], { type }), fileName);
}
