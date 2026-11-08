import { describe, expect, it } from "vitest";
import { parseDurationMs, retryAfterMs } from "./retry";

describe("Groq rate-limit clocks", () => {
  it("parses token-bucket reset durations", () => {
    expect(parseDurationMs("250ms")).toBe(250);
    expect(parseDurationMs("2s")).toBe(2000);
    expect(parseDurationMs("7.66s")).toBe(7660);
    expect(parseDurationMs("6m0s")).toBe(360_000);
    expect(parseDurationMs("1m30s")).toBe(90_000);
    expect(parseDurationMs("2")).toBe(2000);
  });

  it("waits for the later of Retry-After and the token bucket reset", () => {
    const headers = new Headers({
      "retry-after": "1",
      "x-ratelimit-reset-tokens": "5s",
      "x-ratelimit-reset-requests": "2s",
    });
    expect(retryAfterMs(headers, "")).toBe(5000);
  });

  it("reads the provider body when headers are missing", () => {
    const headers = new Headers();
    expect(retryAfterMs(headers, "Please try again in 1.2s.")).toBe(1200);
  });
});
