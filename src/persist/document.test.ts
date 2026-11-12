import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, DEFAULT_PRICE, fold, orchestrate, type CrewEvent } from "../core";
import { PRESETS } from "../demo/presets";
import { ScriptedModel } from "../demo/scripted-model";
import { FixtureSearch } from "../tools/fixture-search";
import {
  buildRunRecord,
  formatSavedAt,
  mergeSummaries,
  parseStoredRun,
  reopenedCopy,
  runKindLabel,
  runListDetail,
  toSummary,
} from "./document";
import { ownerIdForKey } from "./owner";
import { redactText } from "./redact";

const RUN_ID = "00000000-0000-4000-8000-0000000000aa";
const NOW = "2026-11-12T03:00:00.000Z";
const LATER = "2026-11-12T03:05:00.000Z";

describe("run documents", () => {
  it("stores a real scripted demo run as a demo document", async () => {
    const events: CrewEvent[] = [];
    for await (const event of orchestrate(PRESETS[0]?.topic ?? "How does a shared blackboard keep a crew consistent?", {
      llm: new ScriptedModel(),
      search: new FixtureSearch(),
      budget: DEFAULT_BUDGET,
      price: DEFAULT_PRICE,
      maxRevisions: 2,
      mode: "demo",
      runId: RUN_ID,
      model: "demo-scripted",
    })) {
      events.push(event);
    }
    const board = fold(events);
    const ownerId = await ownerIdForKey("ab".repeat(32));
    const record = buildRunRecord(board, ownerId, null, NOW);
    expect(record, "scripted board should be a valid document").not.toBeNull();
    expect(record?.mode).toBe("demo");
    expect(record?.model).toBe("demo-scripted");
    expect(record?.evidence).toBe("fixture-corpus");
    expect(runKindLabel(record!)).toBe("Demo");
    expect(record?.blackboard.events.some((event) => event.type === "tool_result")).toBe(true);
    expect(record?.blackboard.report?.sources.length).toBeGreaterThan(0);
    const roundTrip = parseStoredRun(JSON.parse(JSON.stringify(record)), ownerId);
    expect(roundTrip.ok).toBe(true);
    if (roundTrip.ok) {
      expect(toSummary(roundTrip.record).eventCount).toBe(board.events.length);
      expect(runListDetail(toSummary(roundTrip.record), Date.parse(LATER))).toContain("Demo · scripted");
    }
  });

  it("keeps createdAt and labels an in-progress snapshot", async () => {
    const ownerId = await ownerIdForKey("cd".repeat(32));
    const running = buildRunRecord(fold([started(RUN_ID)]), ownerId, null, NOW);
    expect(running?.status).toBe("running");
    expect(running?.finishedAt).toBeNull();
    const finished = buildRunRecord(
      fold([
        started(RUN_ID),
        {
          type: "run_finished",
          status: "complete",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0, calls: 1 },
        },
      ]),
      ownerId,
      running ? { createdAt: running.createdAt, finishedAt: running.finishedAt } : null,
      LATER,
    );
    expect(finished?.createdAt).toBe(NOW);
    expect(finished?.finishedAt).toBe(LATER);
    expect(finished?.updatedAt).toBe(LATER);
  });

  it("does not present a scripted trace as a live model run", () => {
    expect(runKindLabel({ mode: "demo", model: "demo-scripted", evidence: "fixture-corpus" })).toBe("Demo");
    expect(runKindLabel({ mode: "live", model: "demo-scripted", evidence: "wikipedia" })).toBe("Demo");
    expect(runKindLabel({ mode: "live", model: "qwen/qwen3.8-27b", evidence: "fixture-corpus" })).toBe("Demo");
    expect(runKindLabel({ mode: "live", model: "qwen/qwen3.8-27b", evidence: "wikipedia" })).toBe("Live");
    expect(reopenedCopy({ mode: "demo", model: "demo-scripted", evidence: "fixture-corpus", status: "complete" })).toContain(
      "demo",
    );
    expect(reopenedCopy({ mode: "demo", model: "demo-scripted", evidence: "fixture-corpus", status: "running" })).toContain(
      "snapshot",
    );
  });

  it("merges summaries by newest update and formats time", () => {
    const older = summary("00000000-0000-4000-8000-000000000001", NOW);
    const newer = { ...older, updatedAt: LATER, status: "complete" as const };
    expect(mergeSummaries([older], [newer])[0]?.updatedAt).toBe(LATER);
    expect(mergeSummaries([newer], []).map((item) => item.id)).toEqual([newer.id]);
    expect(formatSavedAt(NOW, Date.parse(NOW) + 10_000)).toBe("just now");
    expect(formatSavedAt(NOW, Date.parse(NOW) + 5 * 60_000)).toBe("5m ago");
  });

  it("redacts a MongoDB URI and its password", () => {
    const uri = "mongodb+srv://owner:s3cret-password@cluster0.example.net/agent_crew?retryWrites=true";
    const text = redactText(`connect failed ${uri} password s3cret-password`, uri);
    expect(text).not.toContain("s3cret-password");
    expect(text).not.toContain("mongodb+srv");
    expect(text).not.toContain("cluster0");
    expect(text).toContain("[redacted]");
  });
});

function started(runId: string): CrewEvent {
  return {
    type: "run_started",
    runId,
    topic: "How does a shared blackboard keep a multi-agent crew consistent?",
    mode: "demo",
    model: "demo-scripted",
    evidence: "fixture-corpus",
    maxRevisions: 2,
    budget: { maxTokens: 8000, maxCostUsd: 0.05 },
  };
}

function summary(id: string, updatedAt: string) {
  return {
    id,
    topic: "How does a shared blackboard keep a multi-agent crew consistent?",
    mode: "demo" as const,
    status: "running" as const,
    model: "demo-scripted",
    evidence: "fixture-corpus",
    createdAt: NOW,
    updatedAt,
    finishedAt: null,
    totalTokens: 0,
    costUsd: 0,
    calls: 0,
    sourceCount: 0,
    eventCount: 1,
  };
}
