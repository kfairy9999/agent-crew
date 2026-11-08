import { describe, expect, it } from "vitest";
import { addUsage, costUsd, emptyUsage, wouldExceed } from "./budget";

const price = { promptPerMillionUsd: 1, completionPerMillionUsd: 2 };

describe("budget", () => {
  it("prices prompt and completion tokens separately", () => {
    expect(costUsd(1_000_000, 0, price)).toBe(1);
    expect(costUsd(0, 500_000, price)).toBe(1);
    expect(costUsd(250, 250, price)).toBe(0.00075);
  });

  it("refuses a call that would cross either ceiling", () => {
    const usage = addUsage(emptyUsage(), { promptTokens: 700, completionTokens: 100 }, price);
    expect(wouldExceed(usage, { maxTokens: 1000, maxCostUsd: 10 }, price, { promptTokens: 100, completionTokens: 100 })).toBe(false);
    expect(wouldExceed(usage, { maxTokens: 800, maxCostUsd: 10 }, price, { promptTokens: 100, completionTokens: 100 })).toBe(true);
    expect(wouldExceed(usage, { maxTokens: 10_000, maxCostUsd: 0.0005 }, price, { promptTokens: 100, completionTokens: 100 })).toBe(true);
  });
});
