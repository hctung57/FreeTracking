import * as XLSX from "xlsx";
import { createWorkbook, createWorkbookFromRows, workbookToBlob } from "../shared/excel.js";
import { normalizeTrackingInput } from "../shared/tracking.js";

const TRACKING_ID_COLUMN = "TRACKING_ID";
const TRACKING_STATUS_COLUMN = "TRACKING_STATUS";

const trackingInput = document.getElementById("trackingInput");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const manualModeButton = document.getElementById("manualModeButton");
const fileModeButton = document.getElementById("fileModeButton");
const manualInputSection = document.getElementById("manualInputSection");
const fileInputSection = document.getElementById("fileInputSection");
const actionButton = document.getElementById("actionButton");
const downloadButton = document.getElementById("downloadButton");
const totalCount = document.getElementById("totalCount");
const processedCount = document.getElementById("processedCount");
const successCount = document.getElementById("successCount");
const errorCount = document.getElementById("errorCount");
const currentStatus = document.getElementById("currentStatus");
const logList = document.getElementById("logList");
const logCount = document.getElementById("logCount");
const progressBar = document.getElementById("progressBar");
const resetButton = document.getElementById("resetButton");
const progressWrap = document.getElementById("progressWrap");

let uploadedFileData = null;
let inputMode = "manual";
let latestState = null;
let countdownTimer = null;

function setInputMode(mode) {
  inputMode = mode === "file" ? "file" : "manual";
  const isManualMode = inputMode === "manual";

  manualModeButton.classList.toggle("active", isManualMode);
  fileModeButton.classList.toggle("active", !isManualMode);
  manualInputSection.classList.toggle("hidden", !isManualMode);
  fileInputSection.classList.toggle("hidden", isManualMode);
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function formatStatus(state) {
  if (state.status === "running") {
    if (state.phase === "waiting") {
      return formatWaitStatus(state);
    }

    return state.currentTracking ? `Processing ${state.currentTracking}` : "Running";
  }

  if (state.status === "done") {
    return "Completed";
  }

  if (state.status === "stopped") {
    const total = Number(state.total ?? 0);
    const processed = Number(state.processed ?? 0);
    const progressPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    return `Stopped at ${progressPercent}%`;
  }

  return "Idle";
}

function getRemainingSeconds(state) {
  if (state.waitUntil) {
    const remainingMs = new Date(state.waitUntil).getTime() - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  return Math.max(0, Number(state.waitRemainingSeconds || 0));
}

function formatWaitStatus(state) {
  const seconds = getRemainingSeconds(state);
  return `Next batch in ${seconds}s`;
}

function renderCounts(state) {
  const total = Number(state.total ?? 0);
  const processed = Number(state.processed ?? 0);
  const progressPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isRunning = state.status === "running";
  const isStopped = state.status === "stopped";
  const isDone = state.status === "done";

  totalCount.textContent = String(state.total ?? 0);
  processedCount.textContent = String(state.processed ?? 0);
  successCount.textContent = String(state.success ?? 0);
  errorCount.textContent = String(state.error ?? 0);
  currentStatus.textContent = state.status === "running" && state.phase === "waiting" ? formatWaitStatus(state) : isStopped ? `Stopped at ${progressPercent}%` : `${progressPercent}%`;
  progressBar.style.width = `${progressPercent}%`;
  progressBar.classList.toggle("running", isRunning);
  progressBar.classList.toggle("waiting", isRunning && state.phase === "waiting");
  progressBar.classList.toggle("done", isDone && progressPercent === 100);
  progressBar.classList.toggle("stopped", isStopped);
  progressWrap.classList.toggle("hidden", !(isRunning || isDone || isStopped));
  actionButton.textContent = state.status === "running" ? "Stop" : state.status === "stopped" ? "Continue" : "Start";
  actionButton.classList.toggle("danger", state.status === "running");
}

function renderLogs(results) {
  logList.innerHTML = "";
  logCount.textContent = `${results.length} items`;

  if (!results || results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-item";
    empty.innerHTML = "<strong>No results yet</strong><div>Paste tracking numbers and start a job.</div>";
    logList.appendChild(empty);
    return;
  }

  for (const result of results.slice(-50)) {
    const item = document.createElement("div");
    item.className = `log-item ${result.error ? "error" : "success"}`;
    item.innerHTML = `
      <strong>${result.trackingNumber}</strong>
      <div>${result.error || result.tracking_detail || result.currentDetail || result.status || "Pending"}</div>
    `;
    logList.appendChild(item);
  }

  logList.scrollTop = logList.scrollHeight;
}

function detectFormatFromName(fileName) {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".csv")) {
    return "csv";
  }

  return "xlsx";
}

function normalizeHeader(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeTrackingValue(value) {
  return String(value || "")
    .trim()
    .replace(/^'+/, "")
    .replace(/'+$/, "");
}

function extractTrackingFromRows(rows, trackingHeader) {
  const seen = new Set();
  const values = [];

  for (const row of rows) {
    const tracking = normalizeTrackingValue(row[trackingHeader]);
    if (!tracking || seen.has(tracking)) {
      continue;
    }

    seen.add(tracking);
    values.push(tracking);
  }

  return values;
}

function getTrackingNumbersForJob() {
  if (inputMode === "file") {
    return uploadedFileData?.trackingNumbers || [];
  }

  return normalizeTrackingInput(String(trackingInput.value || ""));
}

function buildStatusMap(results) {
  const statusMap = new Map();

  for (const result of results) {
    const tracking = normalizeTrackingValue(result.trackingNumber);
    if (!tracking) {
      continue;
    }

    const value = result.error ? `ERROR: ${result.error}` : result.tracking_detail || result.currentDetail || result.status || "";
    statusMap.set(tracking, value);
  }

  return statusMap;
}

function buildUpdatedRows(rows, trackingHeader, statusHeader, statusMap) {
  return rows.map((row) => {
    const tracking = normalizeTrackingValue(row[trackingHeader]);
    if (!tracking) {
      return { ...row };
    }

    return {
      ...row,
      [statusHeader]: statusMap.get(tracking) || row[statusHeader] || ""
    };
  });
}

async function handleFileUpload(file) {
  const fileBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(fileBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];

  if (!firstSheet) {
    throw new Error("The uploaded file does not contain a worksheet");
  }

  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false });
  if (rows.length === 0) {
    throw new Error("The uploaded file has no data rows");
  }

  const headers = Object.keys(rows[0]);
  const headerMap = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const trackingHeader = headerMap.get(TRACKING_ID_COLUMN);
  const statusHeader = headerMap.get(TRACKING_STATUS_COLUMN) || TRACKING_STATUS_COLUMN;

  if (!trackingHeader) {
    throw new Error("Column TRACKING_ID was not found in the uploaded file");
  }

  const trackingNumbers = extractTrackingFromRows(rows, trackingHeader);
  if (trackingNumbers.length === 0) {
    throw new Error("No valid tracking numbers found in TRACKING_ID column");
  }

  const normalizedHeaders = headers.includes(statusHeader) ? headers : [...headers, statusHeader];

  uploadedFileData = {
    name: file.name,
    format: detectFormatFromName(file.name),
    rows,
    headers: normalizedHeaders,
    sheetName: firstSheetName || "Orders",
    trackingHeader,
    statusHeader,
    trackingNumbers
  };

  fileInfo.textContent = `${file.name} — ${trackingNumbers.length} tracking IDs`;
  fileRow.style.display = "flex";
}

function updateUi(state) {
  latestState = state;
  renderCounts(state);
  renderLogs(state.results || []);
  const downloadReady = state.status === "done" && state.results && state.results.length > 0;
  downloadButton.disabled = !downloadReady;
  downloadButton.classList.toggle("ready", downloadReady);
  downloadButton.title = downloadReady
    ? "Download tracking results"
    : state.status === "running" || state.status === "stopped"
      ? "Wait for the job to complete"
      : "Start a job to enable download";
  actionButton.disabled = false;
  resetButton.disabled = state.status === "running";

  if (state.status === "running" && countdownTimer === null) {
    startCountdownTicker();
  }
}

function startCountdownTicker() {
  if (countdownTimer !== null) {
    return;
  }

  countdownTimer = window.setInterval(() => {
    if (!latestState) {
      return;
    }

    if (latestState.status === "running" && latestState.phase === "waiting") {
      renderCounts(latestState);
      return;
    }

    if (latestState.status === "done" || latestState.status === "idle" || latestState.status === "stopped") {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }, 250);
}

async function refreshState() {
  const response = await sendMessage({ type: "FREE_TRACKING_GET_STATE" });
  if (response?.ok) {
    updateUi(response.state);
  }
}

async function startJob() {
  const trackingNumbers = getTrackingNumbersForJob();

  if (inputMode === "file" && !uploadedFileData) {
    currentStatus.textContent = "0%";
    fileInfo.textContent = "Please select an order file first";
    return;
  }

  if (trackingNumbers.length === 0) {
    currentStatus.textContent = "Enter at least one tracking number";
    return;
  }

  actionButton.disabled = true;
  downloadButton.disabled = true;
  resetButton.disabled = true;

  const response = await sendMessage({
    type: "FREE_TRACKING_START_JOB",
    trackingNumbers
  });

  if (!response?.ok) {
    currentStatus.textContent = response?.error || "Unable to start job";
    actionButton.disabled = false;
    return;
  }

  await refreshState();
}

async function stopJob() {
  const response = await sendMessage({ type: "FREE_TRACKING_STOP_JOB" });
  if (!response?.ok) {
    currentStatus.textContent = response?.error || "Unable to stop job";
    return;
  }

  await refreshState();
}

async function continueJob() {
  const response = await sendMessage({ type: "FREE_TRACKING_CONTINUE_JOB" });
  if (!response?.ok) {
    currentStatus.textContent = response?.error || "Unable to continue job";
    return;
  }

  await refreshState();
}

async function runPrimaryAction() {
  const status = latestState?.status || "idle";

  if (status === "running") {
    return stopJob();
  }

  if (status === "stopped") {
    return continueJob();
  }

  return startJob();
}

async function downloadExcel() {
  const response = await sendMessage({ type: "FREE_TRACKING_GET_RESULTS" });
  if (!response?.ok) {
    currentStatus.textContent = response?.error || "Unable to load results";
    return;
  }

  const results = response.results || [];

  let workbook = null;
  let outputFormat = "xlsx";
  let outputNamePrefix = "usps-tracking";

  if (uploadedFileData) {
    const statusMap = buildStatusMap(results);
    const updatedRows = buildUpdatedRows(
      uploadedFileData.rows,
      uploadedFileData.trackingHeader,
      uploadedFileData.statusHeader,
      statusMap
    );

    workbook = createWorkbookFromRows(updatedRows, uploadedFileData.headers, uploadedFileData.sheetName);
    outputFormat = uploadedFileData.format;
    outputNamePrefix = uploadedFileData.name.replace(/\.[^.]+$/, "") || "orders-updated";
  } else {
    workbook = createWorkbook(results);
  }

  const blob = workbookToBlob(workbook, outputFormat);
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = outputFormat === "csv" ? "csv" : "xlsx";

  try {
    await chrome.downloads.download({
      url,
      filename: `${outputNamePrefix}-updated-${timestamp}.${extension}`,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

async function resetState() {
  const response = await sendMessage({ type: "FREE_TRACKING_RESET_STATE" });
  if (!response?.ok) {
    currentStatus.textContent = "0%";
    throw new Error(response?.error || "Unable to reset state");
  }

  trackingInput.value = "";
  fileInput.value = "";
  fileInfo.textContent = "";
  fileRow.style.display = "none";
  uploadedFileData = null;
  await refreshState();
}

actionButton.addEventListener("click", () => {
  runPrimaryAction().catch((error) => {
    currentStatus.textContent = error instanceof Error ? error.message : String(error);
    actionButton.disabled = false;
  });
});

downloadButton.addEventListener("click", () => {
  downloadExcel().catch((error) => {
    currentStatus.textContent = error instanceof Error ? error.message : String(error);
  });
});

resetButton.addEventListener("click", () => {
  resetState().catch((error) => {
    currentStatus.textContent = "0%";
    console.error(error);
  });
});

manualModeButton.addEventListener("click", () => {
  setInputMode("manual");
});

fileModeButton.addEventListener("click", () => {
  setInputMode("file");
});

const uploadZone = document.getElementById("uploadZone");
const fileRow = document.getElementById("fileRow");

uploadZone.addEventListener("click", () => {
  fileInput.click();
});

uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadZone.classList.add("dragover");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("dragover");
});

uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadZone.classList.remove("dragover");
  const [file] = event.dataTransfer?.files || [];
  if (file) {
    fileInput.files = event.dataTransfer.files;
    fileInput.dispatchEvent(new Event("change"));
  }
});

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files || [];

  if (!file) {
    fileInfo.textContent = "";
    fileRow.style.display = "none";
    uploadedFileData = null;
    return;
  }

  handleFileUpload(file).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    uploadedFileData = null;
    fileInput.value = "";
    fileInfo.textContent = `Upload failed: ${message}`;
    fileRow.style.display = "flex";
    currentStatus.textContent = "0%";
    console.error(error);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "FREE_TRACKING_STATE_UPDATED" && message.state) {
    updateUi(message.state);
  }
});

refreshState().catch((error) => {
  currentStatus.textContent = error instanceof Error ? error.message : String(error);
});

setInputMode("manual");
startCountdownTicker();
