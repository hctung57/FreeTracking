export const USPS_TRACKING_URL = "https://tools.usps.com/tracking/";
export const USPS_BATCH_SIZE = 35;

export function normalizeTrackingInput(rawText) {
  const seen = new Set();

  return rawText
    .split(/\r?\n|,|\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    });
}

export function buildTrackingUrl(trackingNumber) {
  return `${USPS_TRACKING_URL}${encodeURIComponent(trackingNumber)}`;
}

export function buildBatchTrackingUrl(trackingNumbers) {
  return `${USPS_TRACKING_URL}${trackingNumbers.map((trackingNumber) => encodeURIComponent(trackingNumber)).join(",")}`;
}

export function chunkTrackingNumbers(trackingNumbers, batchSize = USPS_BATCH_SIZE) {
  const chunks = [];

  for (let index = 0; index < trackingNumbers.length; index += batchSize) {
    chunks.push(trackingNumbers.slice(index, index + batchSize));
  }

  return chunks;
}

export function createEmptyResult(trackingNumber) {
  return {
    trackingNumber,
    tracking_detail: "",
    error: ""
  };
}
