import { describe, expect, it } from "vitest";
import { createBlackboard, fold, reduce } from "./reduce";
import type { CrewEvent } from "./types";

describe("reduce", () => {
  it("does not mutate the previous blackboard", () => {
    const initial = createBlackboard({ topic: "before" });
    const snapshot = structuredClone(initial);
    const event: CrewEvent = {
      type: "run_started",
      runId: "run_1",
      topic: "after",
      mode: "demo",
      model: "demo-scripted",
      evidence: "fixture-corpus",
      maxRevisions: 2,
      budget: { maxTokens: 10, maxCostUsd: 1 },
    };
    const next = reduce(initial, event);
    expect(initial).toEqual(snapshot);
    expect(next.topic).toBe("after");
    expect(next.status).toBe("running");
    expect(fold([event]).runId).toBe("run_1");
  });
});
