import { describe, expect, it } from "vitest";
import { checkCitations } from "../core/citations";
import { orchestrate } from "../core/orchestrator";
import { fold } from "../core/reduce";
import { FixtureSearch } from "../tools/fixture-search";
import { PRESETS } from "./presets";
import { ScriptedModel } from "./scripted-model";
import type { CrewEvent } from "../core/types";

describe("scripted demo runs", () => {
  it.each(PRESETS.map((preset) => [preset.id, preset.topic] as const))(
    "preset %s revises once and cites only retrieved fixtures",
    async (_id, topic) => {
      const events = await collect(run(topic));
      const board = fold(events);
      expect(board.status).toBe("complete");
      expect(board.revision).toBe(1);
      expect(board.model).toBe("demo-scripted");
      expect(board.report).toBeTruthy();
      expect(board.report && checkCitations(board.report, board.report.sources)).toEqual([]);
      expect(board.report?.reservations).toEqual([]);
      expect(board.sources.length).toBeGreaterThan(0);
      expect(events.some((event) => event.type === "tool_call")).toBe(true);
      expect(events.some((event) => event.type === "revision")).toBe(true);
    },
  );

  it("refuses to invent coverage for a topic outside the corpus", async () => {
    const board = fold(await collect(run("quantum knitting patterns for satellites")));
    expect(board.status).toBe("complete");
    expect(board.revision).toBe(1);
    expect(board.report?.summary.toLowerCase()).toContain("does not cover");
    expect(board.report && checkCitations(board.report, board.report.sources)).toEqual([]);
  });
});

function run(topic: string): AsyncGenerator<CrewEvent> {
  return orchestrate(topic, {
    llm: new ScriptedModel(),
    search: new FixtureSearch(),
    budget: { maxTokens: 8000, maxCostUsd: 1 },
    price: { promptPerMillionUsd: 0.29, completionPerMillionUsd: 0.59 },
    maxRevisions: 2,
    mode: "demo",
    runId: "demo_test",
    model: "demo-scripted",
    estimate: { promptTokens: 50, completionTokens: 50 },
  });
}

async function collect(events: AsyncGenerator<CrewEvent>): Promise<CrewEvent[]> {
  const all: CrewEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}
