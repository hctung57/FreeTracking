import { createWorkbook, workbookToBlob } from "../shared/excel.js";
import { normalizeTrackingInput } from "../shared/tracking.js";

const trackingInput = document.getElementById("trackingInput");
const startButton = document.getElementById("startButton");
const downloadButton = document.getElementById("downloadButton");
const totalCount = document.getElementById("totalCount");
const processedCount = document.getElementById("processedCount");
const successCount = document.getElementById("successCount");
const errorCount = document.getElementById("errorCount");
const currentStatus = document.getElementById("currentStatus");
const logList = document.getElementById("logList");

let latestState = {
  status: "idle",
  results: [],
  total: 0,
  processed: 0,
  success: 0,
  error: 0,
  currentTracking: ""
};

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
    return state.currentTracking ? `Processing ${state.currentTracking}` : "Running";
  }

  if (state.status === "done") {
    return "Completed";
  }

  return "Idle";
}

function renderCounts(state) {
  totalCount.textContent = String(state.total ?? 0);
  processedCount.textContent = String(state.processed ?? 0);
  successCount.textContent = String(state.success ?? 0);
  errorCount.textContent = String(state.error ?? 0);
  currentStatus.textContent = formatStatus(state);
}

function renderLogs(results) {
  logList.innerHTML = "";

  for (const result of results.slice(-50)) {
    const item = document.createElement("div");
    item.className = `log-item ${result.error ? "error" : "success"}`;
    item.innerHTML = `
      <div><strong>${result.trackingNumber}</strong></div>
      <div>${result.error || result.tracking_detail || result.currentDetail || result.status || "Pending"}</div>
    `;
    logList.appendChild(item);
  }
}

function updateUi(state) {
  latestState = state;
  renderCounts(state);
  renderLogs(state.results || []);
  downloadButton.disabled = !(state.results && state.results.length > 0);
}

async function refreshState() {
  const response = await sendMessage({ type: "FREE_TRACKING_GET_STATE" });
  if (response?.ok) {
    updateUi(response.state);
  }
}

async function startJob() {
  const trackingNumbers = normalizeTrackingInput(String(trackingInput.value || ""));

  if (trackingNumbers.length === 0) {
    currentStatus.textContent = "Please enter at least one tracking number";
    return;
  }

  startButton.disabled = true;
  downloadButton.disabled = true;

  const response = await sendMessage({
    type: "FREE_TRACKING_START_JOB",
    trackingNumbers
  });

  if (!response?.ok) {
    currentStatus.textContent = response?.error || "Unable to start job";
    startButton.disabled = false;
    return;
  }

  await refreshState();
}

async function downloadExcel() {
  const response = await sendMessage({ type: "FREE_TRACKING_GET_RESULTS" });
  if (!response?.ok) {
    currentStatus.textContent = response?.error || "Unable to load results";
    return;
  }

  const workbook = createWorkbook(response.results || []);
  const blob = workbookToBlob(workbook);
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  try {
    await chrome.downloads.download({
      url,
      filename: `usps-tracking-${timestamp}.xlsx`,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

startButton.addEventListener("click", () => {
  startJob().catch((error) => {
    currentStatus.textContent = error instanceof Error ? error.message : String(error);
    startButton.disabled = false;
  });
});

downloadButton.addEventListener("click", () => {
  downloadExcel().catch((error) => {
    currentStatus.textContent = error instanceof Error ? error.message : String(error);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "FREE_TRACKING_STATE_UPDATED" && message.state) {
    updateUi(message.state);
    if (message.state.status !== "running") {
      startButton.disabled = false;
    }
  }
});

refreshState().catch((error) => {
  currentStatus.textContent = error instanceof Error ? error.message : String(error);
});
