import { describe, expect, it } from "vitest";
import { delayFor, paceEvents } from "./pace";
import type { CrewEvent } from "./types";

const events: CrewEvent[] = [
  {
    type: "run_started",
    runId: "1",
    topic: "t",
    mode: "demo",
    model: "demo-scripted",
    evidence: "fixture-corpus",
    maxRevisions: 2,
    budget: { maxTokens: 1, maxCostUsd: 1 },
  },
  { type: "thought", agent: "planner", text: "Looking at the question." },
];

describe("paceEvents", () => {
  it("sleeps between realtime events and skips the first", async () => {
    const sleeps: number[] = [];
    const seen: string[] = [];
    for await (const event of paceEvents(stream(), {
      pace: "realtime",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    })) {
      seen.push(event.type);
    }
    expect(seen).toEqual(["run_started", "thought"]);
    expect(sleeps).toEqual([delayFor(events[1]!)]);
  });

  it("does not sleep in instant mode", async () => {
    let slept = 0;
    const seen: string[] = [];
    for await (const event of paceEvents(stream(), {
      pace: "instant",
      sleep: async () => {
        slept += 1;
      },
    })) {
      seen.push(event.type);
    }
    expect(slept).toBe(0);
    expect(seen).toHaveLength(2);
  });
});

async function* stream(): AsyncGenerator<CrewEvent> {
  for (const event of events) yield event;
}
