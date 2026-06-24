import * as XLSX from "xlsx";

export function buildWorkbookRows(results) {
  return results.map((result) => ({
    trackingNumber: result.trackingNumber,
    tracking_detail: result.tracking_detail || result.currentDetail || result.status || "",
    error: result.error
  }));
}

export function createWorkbook(results) {
  const workbook = XLSX.utils.book_new();
  const rows = buildWorkbookRows(results);
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: ["trackingNumber", "tracking_detail", "error"]
  });

  XLSX.utils.book_append_sheet(workbook, sheet, "USPS Tracking");
  return workbook;
}

export function createWorkbookFromRows(rows, headers, sheetName = "Orders") {
  const workbook = XLSX.utils.book_new();
  const safeHeaders = Array.isArray(headers) && headers.length > 0 ? headers : Object.keys(rows[0] || {});
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: safeHeaders,
    skipHeader: false
  });

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
}

export function workbookToBlob(workbook, format = "xlsx") {
  const normalizedFormat = format === "csv" ? "csv" : "xlsx";
  const arrayBuffer = XLSX.write(workbook, { bookType: normalizedFormat, type: "array" });

  const mimeType =
    normalizedFormat === "csv"
      ? "text/csv;charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  return new Blob([arrayBuffer], {
    type: mimeType
  });
}
