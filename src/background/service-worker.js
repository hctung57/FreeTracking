import { USPS_BATCH_SIZE, buildBatchTrackingUrl, createEmptyResult } from "../shared/tracking.js";

const STORAGE_KEY = "freeTrackingState";
const JOB_STATUS_IDLE = "idle";
const JOB_STATUS_RUNNING = "running";
const JOB_STATUS_STOPPED = "stopped";
const JOB_STATUS_DONE = "done";
const DASHBOARD_URL = "dist/app/app.html";
const NEXT_BATCH_ALARM_NAME = "freeTrackingNextBatch";
const MIN_BATCH_DELAY_MS = 5000;
const MAX_BATCH_DELAY_MS = 20000;
const MAX_BATCH_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const MAX_RESULTS = 10000;

const state = {
  jobId: "",
  status: JOB_STATUS_IDLE,
  queue: [],
  results: [],
  total: 0,
  processed: 0,
  success: 0,
  error: 0,
  resultsTrimmed: 0,
  currentTracking: "",
  phase: "",
  waitUntil: "",
  waitRemainingSeconds: 0,
  startedAt: "",
  finishedAt: ""
};

let activeRunPromise = null;
let hasLoadedSavedState = false;
let activeBatchTabId = null;

function getDashboardUrl() {
  return chrome.runtime.getURL(DASHBOARD_URL);
}

async function focusOrOpenDashboard() {
  const url = getDashboardUrl();
  const existingTabs = await chrome.tabs.query({ url });

  if (existingTabs.length > 0) {
    const [firstTab] = existingTabs;

    if (firstTab.id !== undefined) {
      await chrome.tabs.update(firstTab.id, { active: true });
      if (firstTab.windowId !== undefined) {
        await chrome.windows.update(firstTab.windowId, { focused: true });
      }
    }

    return;
  }

  await chrome.tabs.create({ url, active: true });
}

function nowIso() {
  return new Date().toISOString();
}

function randomBatchDelayMs() {
  const range = MAX_BATCH_DELAY_MS - MIN_BATCH_DELAY_MS;
  return MIN_BATCH_DELAY_MS + Math.floor(Math.random() * (range + 1));
}

function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryBackoffDelay(attempt) {
  return RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
}

async function updateWaitState(waitUntilMs) {
  state.phase = "waiting";
  state.currentTracking = "";
  state.waitUntil = new Date(waitUntilMs).toISOString();
  state.waitRemainingSeconds = Math.max(0, Math.ceil((waitUntilMs - Date.now()) / 1000));
  await persistState();
  await notifyDashboard();
}

async function clearWaitState() {
  state.phase = "processing";
  state.waitUntil = "";
  state.waitRemainingSeconds = 0;
  await persistState();
  await notifyDashboard();
}

async function scheduleNextBatch(ms) {
  const waitUntilMs = Date.now() + ms;
  await updateWaitState(waitUntilMs);
  await chrome.alarms.clear(NEXT_BATCH_ALARM_NAME);
  await chrome.alarms.create(NEXT_BATCH_ALARM_NAME, {
    when: waitUntilMs
  });
}

function cloneState() {
  return {
    ...state,
    queue: [...state.queue],
    results: state.results.map((item) => ({ ...item }))
  };
}

async function persistState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: cloneState() });
}

async function notifyDashboard() {
  try {
    await chrome.runtime.sendMessage({
      type: "FREE_TRACKING_STATE_UPDATED",
      state: cloneState()
    });
  } catch {
    // Popup may be closed; ignore.
  }
}

async function loadSavedState() {
  const response = await chrome.storage.local.get(STORAGE_KEY);
  const savedState = response[STORAGE_KEY];

  if (savedState && typeof savedState === "object") {
    Object.assign(state, savedState, {
      queue: Array.isArray(savedState.queue) ? [...savedState.queue] : [],
      results: Array.isArray(savedState.results) ? [...savedState.results] : []
    });
  }

  hasLoadedSavedState = true;
}

async function ensureSavedStateLoaded() {
  if (!hasLoadedSavedState) {
    await loadSavedState();
  }
}

async function sendMessageToTab(tabId, message) {
  return await chrome.tabs.sendMessage(tabId, message);
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for tab ${tabId}`));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };

    const removedListener = (removedTabId) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error(`Tab ${tabId} was closed`));
      }
    };

    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removedListener);
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removedListener);
  });
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Ignore failures when the tab was already closed.
  }
}

function isCurrentJob(jobId) {
  return state.status === JOB_STATUS_RUNNING && state.jobId === jobId;
}

function collectBatchResults(batchTrackingNumbers, batchResponse) {
  const responseMap = new Map(
    Array.isArray(batchResponse?.items)
      ? batchResponse.items.map((item) => [item.trackingNumber, item])
      : []
  );

  return batchTrackingNumbers.map((trackingNumber) => {
    const result = createEmptyResult(trackingNumber);
    const item = responseMap.get(trackingNumber);

    if (!item) {
      result.error = "No USPS result returned for this tracking number";
      return result;
    }

    if (item.error) {
      result.error = item.error;
      return result;
    }
    result.tracking_detail = item.tracking_detail || item.currentDetail || item.status || "";
    return result;
  });
}

function totalProcessed() {
  return state.results.length + state.resultsTrimmed;
}

function updateCounters() {
  state.processed = totalProcessed();
  state.success = state.results.filter((result) => !result.error).length;
  state.error = state.results.filter((result) => Boolean(result.error)).length;
}

async function appendResult(result) {
  state.results.push(result);

  while (state.results.length > MAX_RESULTS) {
    state.results.shift();
    state.resultsTrimmed += 1;
  }

  updateCounters();
  await persistState();
  await notifyDashboard();
}

async function runTrackingJob(jobId) {
  if (activeRunPromise) {
    return activeRunPromise;
  }

  activeRunPromise = runTrackingJobInternal(jobId).finally(() => {
    activeRunPromise = null;
  });

  return activeRunPromise;
}

async function runTrackingJobInternal(jobId) {
  while (isCurrentJob(jobId)) {
    const remainingTrackingNumbers = state.queue.slice(totalProcessed());

    if (remainingTrackingNumbers.length === 0) {
      break;
    }

    const batchTrackingNumbers = remainingTrackingNumbers.slice(0, USPS_BATCH_SIZE);
    const currentBatchLabel = batchTrackingNumbers.join(", ");
    state.phase = "processing";
    state.currentTracking = currentBatchLabel;
    state.waitUntil = "";
    state.waitRemainingSeconds = 0;
    await persistState();
    await notifyDashboard();

    let lastError = null;

    for (let attempt = 0; attempt <= MAX_BATCH_RETRIES; attempt++) {
      if (attempt > 0) {
        if (!isCurrentJob(jobId)) {
          break;
        }

        const backoffMs = retryBackoffDelay(attempt - 1);
        state.phase = "retrying";
        state.currentTracking = `Retry ${attempt}/${MAX_BATCH_RETRIES} in ${Math.ceil(backoffMs / 1000)}s`;
        await persistState();
        await notifyDashboard();
        await delayMs(backoffMs);

        if (!isCurrentJob(jobId)) {
          break;
        }

        state.phase = "processing";
        state.currentTracking = currentBatchLabel;
        await persistState();
        await notifyDashboard();
      }

      let tabId = null;

      try {
        const tab = await chrome.tabs.create({ url: buildBatchTrackingUrl(batchTrackingNumbers), active: false });
        tabId = tab.id ?? null;
        activeBatchTabId = tabId;

        if (!tabId) {
          throw new Error("Unable to create tracking tab");
        }

        await waitForTabComplete(tabId);
        if (!isCurrentJob(jobId)) {
          break;
        }

        const response = await sendMessageToTab(tabId, {
          type: "FREE_TRACKING_FETCH_STATUS",
          trackingNumbers: batchTrackingNumbers
        });

        if (!isCurrentJob(jobId)) {
          break;
        }

        if (!response || !response.ok) {
          throw new Error(response?.error || "USPS status could not be read");
        }

        const batchResults = collectBatchResults(batchTrackingNumbers, response);
        if (!isCurrentJob(jobId)) {
          break;
        }

        for (const result of batchResults) {
          if (!isCurrentJob(jobId)) {
            break;
          }

          await appendResult(result);
        }

        lastError = null;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        if (tabId !== null) {
          await closeTab(tabId);
        }

        if (activeBatchTabId === tabId) {
          activeBatchTabId = null;
        }
      }
    }

    if (lastError && isCurrentJob(jobId)) {
      for (const trackingNumber of batchTrackingNumbers) {
        if (!isCurrentJob(jobId)) {
          break;
        }

        const result = createEmptyResult(trackingNumber);
        result.error = lastError;
        await appendResult(result);
      }
    }

    const remainingAfterBatch = state.queue.length - totalProcessed();
    if (isCurrentJob(jobId) && remainingAfterBatch > 0) {
      await scheduleNextBatch(randomBatchDelayMs());
      return;
    }
  }

  if (state.jobId === jobId && state.status === JOB_STATUS_RUNNING) {
    await chrome.alarms.clear(NEXT_BATCH_ALARM_NAME);
    state.status = JOB_STATUS_DONE;
    state.currentTracking = "";
    state.phase = "";
    state.waitUntil = "";
    state.waitRemainingSeconds = 0;
    state.finishedAt = nowIso();
    await persistState();
    await notifyDashboard();
  }
}

async function startJob(trackingNumbers) {
  if (state.status === JOB_STATUS_RUNNING) {
    throw new Error("A tracking job is already running");
  }

  const jobId = crypto.randomUUID();
  state.jobId = jobId;
  state.status = JOB_STATUS_RUNNING;
  state.queue = [...trackingNumbers];
  state.results = [];
  state.total = trackingNumbers.length;
  state.processed = 0;
  state.success = 0;
  state.error = 0;
  state.resultsTrimmed = 0;
  state.currentTracking = "";
  state.phase = "processing";
  state.waitUntil = "";
  state.waitRemainingSeconds = 0;
  state.startedAt = nowIso();
  state.finishedAt = "";

  await persistState();
  await notifyDashboard();

  runTrackingJob(jobId)
    .catch(async (error) => {
      state.status = JOB_STATUS_DONE;
      state.currentTracking = "";
      state.phase = "";
      state.waitUntil = "";
      state.waitRemainingSeconds = 0;
      state.finishedAt = nowIso();
      await persistState();
      await notifyDashboard();
      throw error;
    });

  return { ok: true, jobId };
}

async function stopJob() {
  if (state.status !== JOB_STATUS_RUNNING) {
    throw new Error("No running tracking job to stop");
  }

  const jobId = state.jobId;
  await chrome.alarms.clear(NEXT_BATCH_ALARM_NAME);

  if (activeBatchTabId !== null) {
    await closeTab(activeBatchTabId);
    activeBatchTabId = null;
  }

  state.status = JOB_STATUS_STOPPED;
  state.currentTracking = "";
  state.phase = "";
  state.waitUntil = "";
  state.waitRemainingSeconds = 0;
  state.finishedAt = nowIso();

  await persistState();
  await notifyDashboard();

  if (activeRunPromise) {
    activeRunPromise.catch(() => {});
  }

  return { ok: true, jobId };
}

async function continueJob() {
  if (state.status !== JOB_STATUS_STOPPED) {
    throw new Error("No paused tracking job to continue");
  }

  const jobId = state.jobId;
  state.status = JOB_STATUS_RUNNING;
  state.phase = "processing";
  state.currentTracking = "";
  state.waitUntil = "";
  state.waitRemainingSeconds = 0;
  state.startedAt = state.startedAt || nowIso();
  state.finishedAt = "";

  await persistState();
  await notifyDashboard();

  runTrackingJob(jobId).catch(() => {});
  return { ok: true, jobId };
}

async function resetState() {
  if (state.status === JOB_STATUS_RUNNING) {
    throw new Error("Cannot reset while a tracking job is running");
  }

  state.jobId = "";
  state.status = JOB_STATUS_IDLE;
  state.queue = [];
  state.results = [];
  state.total = 0;
  state.processed = 0;
  state.success = 0;
  state.error = 0;
  state.resultsTrimmed = 0;
  state.currentTracking = "";
  state.phase = "";
  state.waitUntil = "";
  state.waitRemainingSeconds = 0;
  state.startedAt = "";
  state.finishedAt = "";

  await persistState();
  await notifyDashboard();
  await chrome.alarms.clear(NEXT_BATCH_ALARM_NAME);
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadSavedState();
  await persistState();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSavedState();
  if (state.status === JOB_STATUS_RUNNING && state.phase === "waiting") {
    const waitUntilMs = new Date(state.waitUntil).getTime();
    if (Number.isFinite(waitUntilMs) && waitUntilMs > Date.now()) {
      await chrome.alarms.create(NEXT_BATCH_ALARM_NAME, { when: waitUntilMs });
    } else {
      await clearWaitState();
      runTrackingJob(state.jobId).catch(() => {});
    }
  }
});

chrome.action.onClicked.addListener(async () => {
  await focusOrOpenDashboard();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== NEXT_BATCH_ALARM_NAME) {
    return;
  }

  loadSavedState()
    .then(async () => {
      if (state.status !== JOB_STATUS_RUNNING || state.phase !== "waiting") {
        return;
      }

      await clearWaitState();
      return runTrackingJob(state.jobId);
    })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleAsync = async () => {
    await ensureSavedStateLoaded();

    if (message?.type === "FREE_TRACKING_START_JOB") {
      const trackingNumbers = Array.isArray(message.trackingNumbers) ? message.trackingNumbers : [];
      return await startJob(trackingNumbers);
    }

    if (message?.type === "FREE_TRACKING_STOP_JOB") {
      return await stopJob();
    }

    if (message?.type === "FREE_TRACKING_CONTINUE_JOB") {
      return await continueJob();
    }

    if (message?.type === "FREE_TRACKING_GET_STATE") {
      return { ok: true, state: cloneState() };
    }

    if (message?.type === "FREE_TRACKING_GET_RESULTS") {
      return { ok: true, results: cloneState().results };
    }

    if (message?.type === "FREE_TRACKING_RESET_STATE") {
      return await resetState();
    }

    return { ok: false, error: "Unknown message type" };
  };

  handleAsync()
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true;
});
