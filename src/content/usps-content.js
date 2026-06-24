function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function getTrackingNumbersFromMessage(message) {
  if (Array.isArray(message?.trackingNumbers)) {
    return message.trackingNumbers.filter(Boolean);
  }

  return [];
}

function waitForDocumentReady(timeoutMs = 30000) {
  if (document.readyState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("USPS page did not finish loading"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("load", onLoad);
    }

    function onLoad() {
      cleanup();
      resolve();
    }

    window.addEventListener("load", onLoad, { once: true });
  });
}

function hasMeaningfulContent(pageText) {
  const text = pageText.toLowerCase();
  return (
    text.includes("tracking") ||
    text.includes("status") ||
    text.includes("delivered") ||
    text.includes("in transit") ||
    text.includes("usps")
  );
}

function waitForMeaningfulContent(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const check = () => {
      const pageText = collectPageText();
      if (hasMeaningfulContent(pageText)) {
        cleanup();
        resolve(pageText);
        return true;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        cleanup();
        reject(new Error("USPS tracking content did not become available"));
        return true;
      }

      return false;
    };

    const observer = new MutationObserver(() => {
      check();
    });

    const intervalId = window.setInterval(() => {
      check();
    }, 500);

    function cleanup() {
      observer.disconnect();
      clearInterval(intervalId);
    }

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    if (!check()) {
      // Continue waiting for dynamic USPS content.
    }
  });
}

function collectPageText() {
  return normalizeText(document.body?.innerText || "");
}

function getText(selector, root = document) {
  const element = root.querySelector(selector);
  return element ? normalizeText(element.textContent || "") : "";
}

function getCurrentStepElement(root = document) {
  return root.querySelector(".tracking-progress-bar-status-container .tb-step.current-step");
}

function getLatestStepElement(root = document) {
  const steps = Array.from(root.querySelectorAll(".tracking-progress-bar-status-container .tb-step"));
  return (
    steps.find(
      (element) =>
        !element.classList.contains("current-step") && !element.classList.contains("toggle-history-container")
    ) || null
  );
}

function detectStatus(root = document) {
  const currentStep = getCurrentStepElement(root);

  if (currentStep) {
    const statusText = getText(".tb-status", currentStep);
    const detailText = getText(".tb-status-detail", currentStep);

    if (statusText || detailText) {
      return [statusText, detailText].filter(Boolean).join(" - ");
    }
  }

  const bannerText = getText(".banner-content", root);
  if (bannerText) {
    return bannerText;
  }

  return document.title ? normalizeText(document.title) : "Unknown";
}

function detectUpdatedAt(root = document) {
  const rootText = normalizeText(root.textContent || "");
  const currentStep = getCurrentStepElement(root);
  const stepDate = getText(".tb-date", currentStep || root);

  if (stepDate) {
    return stepDate;
  }

  const expectedDay = getText(".expected_delivery .day", root);
  const expectedDate = getText(".expected_delivery .date", root);
  const expectedMonthYear = getText(".expected_delivery .month_year", root);

  if (expectedDay || expectedDate || expectedMonthYear) {
    return [expectedDay, expectedDate, expectedMonthYear].filter(Boolean).join(" ");
  }

  const patterns = [
    /(?:Updated|Last updated|Status updated)[^\d]*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*[AP]M)?)?/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*[AP]M)?)/
  ];

  for (const pattern of patterns) {
    const match = rootText.match(pattern);
    if (match && match[1]) {
      return normalizeText(match[1]);
    }
  }

  return "";
}

function detectError(pageText) {
  const errorTexts = [
    "tracking number not found",
    "we are currently unable to retrieve tracking information",
    "service unavailable",
    "invalid tracking number"
  ];

  for (const errorText of errorTexts) {
    if (pageText.toLowerCase().includes(errorText)) {
      return errorText;
    }
  }

  return "";
}

function buildTrackingDetail({ status, location, updatedAt }) {
  return [status, location, updatedAt].filter(Boolean).join(", ");
}

function readTrackingStatusFromRoot(root) {
  const rootText = normalizeText(root.textContent || "");
  const error = detectError(rootText);

  if (error) {
    return {
      ok: false,
      trackingNumber: getText(".tracking-number, #trackingNum", root),
      error: `USPS reported an error: ${error}`
    };
  }

  const trackingNumber = getText(".tracking-number, #trackingNum", root);
  const currentStep = getCurrentStepElement(root);
  const nextStep = getLatestStepElement(root);
  const status = detectStatus(root);
  const updatedAt = detectUpdatedAt(root);
  const location = getText(".tb-location", currentStep || root);
  const trackingDetail = buildTrackingDetail({ status, location, updatedAt });

  return {
    ok: true,
    trackingNumber,
    tracking_detail: trackingDetail,
    nextStatus: nextStep ? getText(".tb-status-detail", nextStep) : "",
    error: ""
  };
}

function readAllTrackingBlocks() {
  const blocks = Array.from(document.querySelectorAll(".product_summary"));

  if (blocks.length === 0) {
    return [readTrackingStatusFromRoot(document.body || document.documentElement)];
  }

  return blocks.map((block) => readTrackingStatusFromRoot(block));
}

function readTrackingStatus() {
  const first = readAllTrackingBlocks()[0];

  if (!first) {
    return {
      ok: false,
      error: "No USPS tracking block found"
    };
  }

  return first;
}

function readBatchTrackingStatus(trackingNumbers) {
  const pageText = collectPageText();
  const pageError = detectError(pageText);
  const parsedItems = readAllTrackingBlocks();

  if (pageError && parsedItems.every((item) => item.ok === false)) {
    return {
      ok: true,
      items: trackingNumbers.map((trackingNumber) => ({
        trackingNumber,
        tracking_detail: "",
        error: `USPS reported an error: ${pageError}`
      }))
    };
  }

  const byTrackingNumber = new Map();
  for (const item of parsedItems) {
    if (item.trackingNumber) {
      byTrackingNumber.set(item.trackingNumber, item);
    }
  }

  return {
    ok: true,
    items: trackingNumbers.map((trackingNumber) => ({
      trackingNumber,
      tracking_detail: byTrackingNumber.get(trackingNumber)?.tracking_detail || "",
      error:
        byTrackingNumber.get(trackingNumber)?.error ||
        (!byTrackingNumber.has(trackingNumber) ? "Tracking number was not found in USPS batch response" : "")
    }))
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "FREE_TRACKING_FETCH_STATUS") {
    return false;
  }

  const handleRequest = async () => {
    await waitForDocumentReady();
    await waitForMeaningfulContent();
    const trackingNumbers = getTrackingNumbersFromMessage(message);

    if (trackingNumbers.length > 1) {
      return readBatchTrackingStatus(trackingNumbers);
    }

    if (trackingNumbers.length === 1) {
      const singleResult = readTrackingStatus();
      return {
        ok: true,
        items: [
          {
            trackingNumber: trackingNumbers[0],
            tracking_detail: singleResult.ok ? singleResult.tracking_detail : "",
            error: singleResult.ok ? "" : singleResult.error
          }
        ]
      };
    }

    return readTrackingStatus();
  };

  handleRequest()
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true;
});
