import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { fold, type CrewEvent } from "../../core";
import { buildRunRecord } from "../../persist/document";
import { ownerIdForKey } from "../../persist/owner";
import { forgetRunDatabase, openRunDatabase, STORAGE_MESSAGE, storageErrorMessage } from "./run-db";

describe("IndexedDB run store", () => {
  it("saves a demo run, lists it, and keeps the owner key", async () => {
    const name = `agent-crew-${crypto.randomUUID()}`;
    const db = await openRunDatabase(name);
    const key = await db.ownerKey();
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await db.ownerKey()).toBe(key);

    const ownerId = await ownerIdForKey(key);
    const older = record(ownerId, "00000000-0000-4000-8000-000000000001", "2026-11-12T03:00:00.000Z");
    const newer = record(ownerId, "00000000-0000-4000-8000-000000000002", "2026-11-12T03:05:00.000Z");
    expect(older && newer).toBeTruthy();
    if (!older || !newer) return;
    await db.save(older);
    await db.save(newer);

    const listed = await db.list();
    expect(listed.map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(listed[0]?.mode).toBe("demo");
    expect(listed[0]?.model).toBe("demo-scripted");
    const loaded = await db.get(newer.id);
    expect(loaded?.blackboard.report?.title).toBe("Shared blackboard");
    expect(loaded?.blackboard.events.some((event) => event.type === "tool_result")).toBe(true);

    forgetRunDatabase(name);
    const reopened = await openRunDatabase(name);
    expect(await reopened.ownerKey()).toBe(key);
    expect((await reopened.list()).length).toBe(2);
  });

  it("hides a record that belongs to another owner key", async () => {
    const name = `agent-crew-${crypto.randomUUID()}`;
    const db = await openRunDatabase(name);
    const other = await ownerIdForKey("cd".repeat(32));
    const foreign = record(other, "00000000-0000-4000-8000-000000000003", "2026-11-12T03:06:00.000Z");
    if (!foreign) throw new Error("fixture");
    await db.save(foreign);
    expect(await db.list()).toEqual([]);
    expect(await db.get(foreign.id)).toBeNull();
  });

  it("names private-mode and quota failures without pretending the desk died", () => {
    expect(storageErrorMessage(new DOMException("quota", "QuotaExceededError"))).toBe(STORAGE_MESSAGE);
    expect(storageErrorMessage(new DOMException("blocked", "SecurityError"))).toBe(STORAGE_MESSAGE);
    expect(storageErrorMessage(new Error("something else"))).toBeNull();
  });

  it("reports a missing IndexedDB as storage unavailable", async () => {
    const name = `missing-${crypto.randomUUID()}`;
    const original = globalThis.indexedDB;
    Reflect.deleteProperty(globalThis, "indexedDB");
    forgetRunDatabase(name);
    try {
      await expect(openRunDatabase(name)).rejects.toThrow(/IndexedDB/);
    } finally {
      globalThis.indexedDB = original;
    }
  });
});

function record(ownerId: string, id: string, now: string) {
  return buildRunRecord(fold(events(id)), ownerId, null, now);
}

function events(id: string): CrewEvent[] {
  return [
    {
      type: "run_started",
      runId: id,
      topic: "How does a shared blackboard keep a multi-agent crew consistent?",
      mode: "demo",
      model: "demo-scripted",
      evidence: "fixture-corpus",
      maxRevisions: 2,
      budget: { maxTokens: 8000, maxCostUsd: 0.05 },
    },
    {
      type: "tool_result",
      agent: "researcher",
      tool: "fixture-corpus",
      callId: "search-1",
      summary: "Shared blackboard",
      sources: [
        {
          id: 1,
          title: "Shared blackboard",
          url: "https://example.com/blackboard",
          snippet: "A reducer applies typed writes.",
          locator: "fixture:blackboard",
        },
      ],
    },
    {
      type: "report",
      report: {
        title: "Shared blackboard",
        summary: "The reducer keeps the crew consistent [1].",
        sections: [{ heading: "Reducer", paragraphs: ["Writes go through one reducer [1]."] }],
        sources: [
          {
            id: 1,
            title: "Shared blackboard",
            url: "https://example.com/blackboard",
            snippet: "A reducer applies typed writes.",
            locator: "fixture:blackboard",
          },
        ],
        reservations: [],
      },
    },
    {
      type: "run_finished",
      status: "complete",
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5, costUsd: 0, calls: 1 },
    },
  ];
}
