import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  USPS_TRACKING_URL,
  USPS_BATCH_SIZE,
  normalizeTrackingInput,
  buildTrackingUrl,
  buildBatchTrackingUrl,
  chunkTrackingNumbers,
  createEmptyResult
} from "../src/shared/tracking.js";

describe("normalizeTrackingInput", () => {
  it("splits on newlines and trims whitespace", () => {
    const input = "  9200190384072908333182  \n  9200190384072908333183\n9200190384072908333184  ";
    const result = normalizeTrackingInput(input);
    assert.deepEqual(result, [
      "9200190384072908333182",
      "9200190384072908333183",
      "9200190384072908333184"
    ]);
  });

  it("splits on commas", () => {
    const input = "9200190384072908333182, 9200190384072908333183,9200190384072908333184";
    const result = normalizeTrackingInput(input);
    assert.deepEqual(result, [
      "9200190384072908333182",
      "9200190384072908333183",
      "9200190384072908333184"
    ]);
  });

  it("splits on whitespace", () => {
    const input = "9200190384072908333182 9200190384072908333183  9200190384072908333184";
    const result = normalizeTrackingInput(input);
    assert.deepEqual(result, [
      "9200190384072908333182",
      "9200190384072908333183",
      "9200190384072908333184"
    ]);
  });

  it("removes duplicate tracking numbers", () => {
    const input = "9200190384072908333182\n9200190384072908333182\n9200190384072908333183";
    const result = normalizeTrackingInput(input);
    assert.deepEqual(result, [
      "9200190384072908333182",
      "9200190384072908333183"
    ]);
  });

  it("returns an empty array for empty input", () => {
    assert.deepEqual(normalizeTrackingInput(""), []);
    assert.deepEqual(normalizeTrackingInput("   \n  \n  "), []);
  });

  it("handles mixed delimiters (newlines + commas + spaces)", () => {
    const input = "A\nB, C D\nE,F";
    const result = normalizeTrackingInput(input);
    assert.deepEqual(result, ["A", "B", "C", "D", "E", "F"]);
  });

  it("preserves order while removing duplicates (first occurrence wins)", () => {
    const input = "Z\nA\nZ\nB\nA";
    const result = normalizeTrackingInput(input);
    assert.deepEqual(result, ["Z", "A", "B"]);
  });
});

describe("buildTrackingUrl", () => {
  it("builds a single tracking URL", () => {
    const url = buildTrackingUrl("9200190384072908333182");
    assert.equal(url, `${USPS_TRACKING_URL}9200190384072908333182`);
  });

  it("encodes special characters in the tracking number", () => {
    const url = buildTrackingUrl("test 123");
    assert.equal(url, `${USPS_TRACKING_URL}test%20123`);
  });
});

describe("buildBatchTrackingUrl", () => {
  it("builds a URL with multiple tracking numbers separated by commas", () => {
    const url = buildBatchTrackingUrl(["A", "B", "C"]);
    assert.equal(url, `${USPS_TRACKING_URL}A,B,C`);
  });

  it("builds a URL with a single tracking number", () => {
    const url = buildBatchTrackingUrl(["9200190384072908333182"]);
    assert.equal(url, `${USPS_TRACKING_URL}9200190384072908333182`);
  });

  it("encodes each tracking number individually", () => {
    const url = buildBatchTrackingUrl(["foo bar", "baz qux"]);
    assert.equal(url, `${USPS_TRACKING_URL}foo%20bar,baz%20qux`);
  });

  it("returns only the base URL for an empty array", () => {
    const url = buildBatchTrackingUrl([]);
    assert.equal(url, USPS_TRACKING_URL);
  });
});

describe("chunkTrackingNumbers", () => {
  it("splits an array into chunks of the given size", () => {
    const input = ["1", "2", "3", "4", "5"];
    const result = chunkTrackingNumbers(input, 2);
    assert.deepEqual(result, [["1", "2"], ["3", "4"], ["5"]]);
  });

  it("uses USPS_BATCH_SIZE as the default chunk size", () => {
    const input = Array.from({ length: USPS_BATCH_SIZE + 1 }, (_, i) => String(i));
    const result = chunkTrackingNumbers(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].length, USPS_BATCH_SIZE);
    assert.equal(result[1].length, 1);
  });

  it("returns a single chunk when the array is smaller than the batch size", () => {
    const input = ["1", "2", "3"];
    const result = chunkTrackingNumbers(input, 10);
    assert.deepEqual(result, [["1", "2", "3"]]);
  });

  it("returns an empty array for an empty input", () => {
    const result = chunkTrackingNumbers([], 5);
    assert.deepEqual(result, []);
  });
});

describe("createEmptyResult", () => {
  it("creates a result object with empty tracking_detail and error", () => {
    const result = createEmptyResult("9200190384072908333182");
    assert.deepEqual(result, {
      trackingNumber: "9200190384072908333182",
      tracking_detail: "",
      error: ""
    });
  });

  it("preserves the tracking number as-is", () => {
    const result = createEmptyResult("  SPACES  ");
    assert.deepEqual(result, {
      trackingNumber: "  SPACES  ",
      tracking_detail: "",
      error: ""
    });
  });
});

describe("USPS_BATCH_SIZE", () => {
  it("is a positive integer", () => {
    assert.equal(typeof USPS_BATCH_SIZE, "number");
    assert.ok(Number.isInteger(USPS_BATCH_SIZE));
    assert.ok(USPS_BATCH_SIZE > 0);
  });
});
