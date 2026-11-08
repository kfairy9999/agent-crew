import { describe, expect, it } from "vitest";
import { checkCitations } from "./citations";
import { orchestrate, type OrchestratorDeps } from "./orchestrator";
import { fold } from "./reduce";
import type { CrewEvent, LlmClient, LlmRequest, LlmResult, SearchTool } from "./types";

const price = { promptPerMillionUsd: 0.29, completionPerMillionUsd: 0.59 };

describe("orchestrate", () => {
  it("revises once when the critic rejects an unknown citation, then publishes the board's sources", async () => {
    const llm = new SequenceLlm([
      plan(),
      research(),
      draft("It is guaranteed [9].", "Concurrent writers are fine [9]."),
      critique("revise", ["Citation [9] is not a retrieved source."]),
      draft("Writes go through one reducer [1].", "The next agent reads the snapshot [1]."),
      critique("approve", []),
    ]);
    const search = new RecordingSearch();
    const events = await collect(orchestrate("How do writes stay ordered?", baseDeps(llm, search)));
    const board = fold(events);

    expect(search.queries).toEqual(["serialized reducer blackboard"]);
    expect(events.filter((event) => event.type === "handoff").map(handoff)).toEqual([
      "planner->researcher",
      "researcher->writer",
      "writer->critic",
      "critic->writer",
      "writer->critic",
    ]);
    expect(board.revision).toBe(1);
    expect(board.status).toBe("complete");
    expect(board.report?.sources.map((source) => source.url)).toEqual(["https://example.com/reducer"]);
    expect(board.report && checkCitations(board.report, board.report.sources)).toEqual([]);
    expect(board.report?.reservations).toEqual([]);
    expect(llm.requests.map((request) => request.agent)).toEqual([
      "planner",
      "researcher",
      "writer",
      "critic",
      "writer",
      "critic",
    ]);
    expect(llm.requests[0]?.messages[1]?.content).toContain("How do writes stay ordered?");
  });

  it("forces a revision when the critic approves a broken citation", async () => {
    const llm = new SequenceLlm([
      plan(),
      research(),
      draft("Looks finished [8].", "Nothing to see [8]."),
      critique("approve", []),
      draft("The reducer serializes the write [1].", "Handoffs name the next edit [1]."),
      critique("approve", []),
    ]);
    const events = await collect(orchestrate("Order", baseDeps(llm, new RecordingSearch())));
    const revision = events.find((event) => event.type === "revision");
    expect(revision?.type === "revision" && revision.reason).toContain("Citation [8]");
    expect(fold(events).status).toBe("complete");
  });

  it("stops at the revision cap and publishes reservations", async () => {
    const outputs = [plan(), research()];
    for (let index = 0; index < 3; index += 1) {
      outputs.push(draft(`Still wrong [${index + 9}].`, `Still wrong [${index + 9}].`), critique("revise", ["Still unsupported."]));
    }
    const llm = new SequenceLlm(outputs);
    const events = await collect(
      orchestrate("Order", { ...baseDeps(llm, new RecordingSearch()), maxRevisions: 2 }),
    );
    const board = fold(events);
    expect(llm.requests.filter((request) => request.agent === "writer")).toHaveLength(3);
    expect(llm.requests.filter((request) => request.agent === "critic")).toHaveLength(3);
    expect(board.status).toBe("complete");
    expect(board.revision).toBe(2);
    expect(board.report?.reservations.some((item) => item.includes("Revision limit"))).toBe(true);
  });

  it("stops before a call that would break the token budget", async () => {
    const llm = new SequenceLlm([plan(), research(), draft("A note [1].", "A note [1]."), critique("approve", [])], {
      promptTokens: 400,
      completionTokens: 400,
    });
    const events = await collect(
      orchestrate("Order", {
        ...baseDeps(llm, new RecordingSearch()),
        budget: { maxTokens: 2500, maxCostUsd: 10 },
        estimate: { promptTokens: 200, completionTokens: 200 },
      }),
    );
    const board = fold(events);
    expect(llm.requests).toHaveLength(3);
    expect(board.status).toBe("budget_exceeded");
    expect(board.report?.title).toBe("Alignment");
    expect(board.report?.reservations.length).toBeGreaterThan(0);
  });

  it("repairs one invalid JSON response", async () => {
    const llm = new SequenceLlm([
      "not json",
      plan(),
      research(),
      draft("A note [1].", "A note [1]."),
      critique("approve", []),
    ]);
    const events = await collect(orchestrate("Order", baseDeps(llm, new RecordingSearch())));
    expect(fold(events).status).toBe("complete");
    expect(llm.requests.filter((request) => request.agent === "planner")).toHaveLength(2);
  });
});

function baseDeps(llm: LlmClient, search: SearchTool): OrchestratorDeps {
  return {
    llm,
    search,
    budget: { maxTokens: 8000, maxCostUsd: 1 },
    price,
    maxRevisions: 2,
    mode: "demo",
    runId: "run_test",
    model: "sequence",
    estimate: { promptTokens: 50, completionTokens: 50 },
  };
}

function plan(): string {
  return JSON.stringify({
    audience: "a reader",
    thesis: "Serialized writes keep the crew aligned.",
    questions: ["How are writes applied?"],
    searchQueries: ["serialized reducer blackboard"],
    outline: ["Mechanism"],
    rationale: "Start with the reducer.",
  });
}

function research(): string {
  return JSON.stringify({
    rationale: "One source is enough to draft.",
    notes: [{ claim: "Writes go through one reducer.", sourceIds: [1], confidence: "high" }],
    gaps: [],
  });
}

function draft(summary: string, paragraph: string): string {
  return JSON.stringify({
    title: "Alignment",
    summary,
    sections: [{ heading: "Mechanism", paragraphs: [paragraph] }],
    rationale: "Drafted from the note.",
  });
}

function critique(verdict: "approve" | "revise", issues: string[]): string {
  return JSON.stringify({
    verdict,
    issues,
    rationale: verdict === "approve" ? "Citations resolve." : "The draft cites a source we do not have.",
  });
}

function handoff(event: CrewEvent): string {
  return event.type === "handoff" ? `${event.from}->${event.to}` : "";
}

class SequenceLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];

  constructor(
    private readonly outputs: string[],
    private readonly usage = { promptTokens: 80, completionTokens: 40 },
  ) {}

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    const content = this.outputs.shift();
    if (content === undefined) throw new Error("SequenceLlm exhausted");
    return { content, ...this.usage, model: "sequence" };
  }
}

class RecordingSearch implements SearchTool {
  readonly name = "recording";
  readonly queries: string[] = [];

  async search(query: string): Promise<{ title: string; url: string; snippet: string; locator: string }[]> {
    this.queries.push(query);
    return [
      {
        title: "Reducer note",
        url: "https://example.com/reducer",
        snippet: "Serialized writes.",
        locator: "doc",
      },
    ];
  }
}

async function collect(events: AsyncGenerator<CrewEvent>): Promise<CrewEvent[]> {
  const all: CrewEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}
