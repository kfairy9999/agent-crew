import { afterEach, describe, expect, it, vi } from "vitest";
import { fold, type CrewEvent } from "../core";
import { buildRunRecord, type RunDocument } from "../persist/document";
import { createOwnerKey, ownerIdForKey } from "../persist/owner";
import { BINDING_KEYS, mongoConfigured, mongoDbName } from "./bindings";
import { createApp } from "./app";
import type { MongoConnector, RunCollection, RunCursor } from "./mongo";

const SECRET = "mongodb+srv://owner:s3cret-password@cluster0.example.net/agent_crew?retryWrites=true";

describe("run archive", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays on IndexedDB when MONGODB_URI is unset and does not open a database", async () => {
    let connections = 0;
    const app = createApp({
      mongoConnect: async () => {
        connections += 1;
        throw new Error("should not connect");
      },
    });
    const config = await app.request("http://local/api/config");
    const body = (await config.json()) as { archive: { browser: string; server: string | null } };
    expect(body.archive).toEqual({ browser: "indexeddb", server: null });
    const listed = await app.request("http://local/api/archive/runs");
    expect(listed.status).toBe(404);
    expect(((await listed.json()) as { code: string }).code).toBe("archive_off");
    expect(connections).toBe(0);
    expect(mongoConfigured(undefined)).toBe(false);
    expect(mongoDbName({})).toBe("agent_crew");
    expect(BINDING_KEYS).toContain("MONGODB_URI");
    expect(BINDING_KEYS).toContain("MONGODB_DB_NAME");
  });

  it("does not return the URI from config when the secret is set", async () => {
    const app = createApp();
    const response = await app.request("http://local/api/config", {}, { MONGODB_URI: SECRET, MONGODB_DB_NAME: "crew_lab" });
    const text = await response.text();
    expect(text).not.toContain("s3cret-password");
    expect(text).not.toContain("mongodb+srv");
    expect(text).not.toContain("cluster0");
    expect(text).not.toContain("MONGODB_URI");
    const body = JSON.parse(text) as { archive: { server: string | null } };
    expect(body.archive.server).toBe("mongodb");
    expect(mongoDbName({ MONGODB_DB_NAME: "crew_lab" })).toBe("crew_lab");
    expect(mongoDbName({ MONGODB_DB_NAME: "bad name" })).toBe("agent_crew");
  });

  it("saves and lists only the calling owner's demo run", async () => {
    const docs = new Map<string, RunDocument>();
    let seen: { uri: string; dbName: string } | null = null;
    const app = createApp({
      mongoConnect: connector(docs, (uri, dbName) => {
        seen = { uri, dbName };
      }),
    });
    const key = createOwnerKey();
    const other = createOwnerKey();
    const ownerId = await ownerIdForKey(key);
    const record = buildRunRecord(fold(demoEvents("00000000-0000-4000-8000-000000000010")), ownerId, null, "2026-11-12T03:00:00.000Z");
    expect(record).not.toBeNull();
    if (!record) return;
    const env = { MONGODB_URI: SECRET, MONGODB_DB_NAME: "crew_lab" };
    const saved = await app.request(archiveUrl(record.id), putInit(key, record), env);
    expect(saved.status).toBe(200);
    expect(seen).toEqual({ uri: SECRET, dbName: "crew_lab" });

    const listed = await app.request("http://local/api/archive/runs", { headers: { "x-owner-key": key } }, env);
    const listBody = (await listed.json()) as { runs: { id: string; mode: string; model: string; evidence: string; status: string }[] };
    expect(listBody.runs).toHaveLength(1);
    expect(listBody.runs[0]).toMatchObject({
      id: record.id,
      mode: "demo",
      model: "demo-scripted",
      evidence: "fixture-corpus",
      status: "complete",
    });
    expect(listBody.runs[0]).not.toHaveProperty("blackboard");

    const foreign = await app.request("http://local/api/archive/runs", { headers: { "x-owner-key": other } }, env);
    expect(((await foreign.json()) as { runs: unknown[] }).runs).toEqual([]);
    const hidden = await app.request(`http://local/api/archive/runs/${record.id}`, { headers: { "x-owner-key": other } }, env);
    expect(hidden.status).toBe(404);

    const loaded = await app.request(`http://local/api/archive/runs/${record.id}`, { headers: { authorization: `Bearer ${key}` } }, env);
    const loadedBody = (await loaded.json()) as { mode: string; model: string; blackboard: { events: { type: string }[]; report: { sources: unknown[] } } };
    expect(loadedBody.mode).toBe("demo");
    expect(loadedBody.model).toBe("demo-scripted");
    expect(loadedBody.blackboard.events.some((event) => event.type === "tool_result")).toBe(true);
    expect(loadedBody.blackboard.report.sources.length).toBeGreaterThan(0);

    const clash = await app.request(archiveUrl(record.id), putInit(other, record), env);
    expect(clash.status).toBe(409);
  });

  it("accepts an in-progress snapshot and rejects a missing owner key", async () => {
    const docs = new Map<string, RunDocument>();
    const app = createApp({ mongoConnect: connector(docs) });
    const env = { MONGODB_URI: SECRET };
    const missing = await app.request("http://local/api/archive/runs", {}, env);
    expect(missing.status).toBe(401);
    const key = createOwnerKey();
    const ownerId = await ownerIdForKey(key);
    const running = buildRunRecord(fold([started("00000000-0000-4000-8000-000000000011")]), ownerId, null, "2026-11-12T03:04:00.000Z");
    if (!running) throw new Error("running snapshot was rejected");
    const saved = await app.request(archiveUrl(running.id), putInit(key, running), env);
    expect(saved.status).toBe(200);
    const listed = await app.request("http://local/api/archive/runs", { headers: { "x-owner-key": key } }, env);
    const body = (await listed.json()) as { runs: { status: string; finishedAt: string | null }[] };
    expect(body.runs[0]?.status).toBe("running");
    expect(body.runs[0]?.finishedAt).toBeNull();
  });

  it("scrubs the URI from archive failures", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
    const app = createApp({
      mongoConnect: async () => {
        throw new Error(`connect failed ${SECRET} password s3cret-password`);
      },
    });
    const key = createOwnerKey();
    const response = await app.request("http://local/api/archive/runs", { headers: { "x-owner-key": key } }, { MONGODB_URI: SECRET });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("s3cret-password");
    expect(text).not.toContain("mongodb");
    expect(errors.join("\n")).not.toContain("s3cret-password");
    expect(errors.join("\n")).not.toContain("cluster0");
  });
});

function connector(docs: Map<string, RunDocument>, onConnect?: (uri: string, dbName: string) => void): MongoConnector {
  return async (uri, dbName) => {
    onConnect?.(uri, dbName);
    return { collection: memoryCollection(docs), close: async () => undefined };
  };
}

function memoryCollection(docs: Map<string, RunDocument>): RunCollection {
  return {
    async replaceOne(filter, replacement) {
      const existing = docs.get(filter._id);
      if (existing && existing.ownerId !== filter.ownerId) {
        const error = new Error("E11000 duplicate key");
        (error as Error & { code: number }).code = 11000;
        throw error;
      }
      docs.set(filter._id, replacement);
    },
    find(filter) {
      let rows = [...docs.values()].filter((doc) => doc.ownerId === filter.ownerId);
      const cursor: RunCursor = {
        sort() {
          rows = [...rows].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
          return cursor;
        },
        limit(count) {
          rows = rows.slice(0, count);
          return cursor;
        },
        async toArray() {
          return rows;
        },
      };
      return cursor;
    },
    async findOne(filter) {
      const doc = docs.get(filter._id);
      if (!doc || doc.ownerId !== filter.ownerId) return null;
      return doc;
    },
  };
}

function archiveUrl(id: string): string {
  return `http://local/api/archive/runs/${id}`;
}

function putInit(key: string, record: unknown): RequestInit {
  return {
    method: "PUT",
    headers: { "content-type": "application/json", "x-owner-key": key },
    body: JSON.stringify(record),
  };
}

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

function demoEvents(runId: string): CrewEvent[] {
  return [
    started(runId),
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
