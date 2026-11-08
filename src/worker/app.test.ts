import { describe, expect, it } from "vitest";
import { createSseParser } from "../core/sse";
import type { CrewEvent } from "../core/types";
import { PRESETS } from "../demo/presets";
import { TokenBucketLimiter } from "../core/rate-limit";
import { createApp } from "./app";

describe("API", () => {
  it("serves health, config, and a fixture page", async () => {
    const app = createApp();
    const health = await app.request("http://local/api/health");
    expect(await health.json()).toEqual({ ok: true });

    const config = await app.request("http://local/api/config");
    const body = (await config.json()) as { liveAvailable: boolean; model: string; demoDefault: boolean };
    expect(body.liveAvailable).toBe(false);
    expect(body.demoDefault).toBe(true);
    expect(body.model).toBe("qwen/qwen3.8-27b");

    const page = await app.request("http://local/api/fixtures/blackboard", {
      headers: { accept: "text/html" },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Shared blackboard");
  });

  it("streams a demo run to a cited report without a key", async () => {
    const app = createApp();
    const response = await app.request("http://local/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: PRESETS[0]?.topic, mode: "demo", pace: "instant" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await response.text());
    expect(events.some((event) => event.type === "tool_call")).toBe(true);
    expect(events.some((event) => event.type === "handoff")).toBe(true);
    const finished = events.find((event) => event.type === "run_finished");
    const report = events.find((event) => event.type === "report");
    expect(finished?.type === "run_finished" && finished.status).toBe("complete");
    expect(report?.type === "report" && report.report.sources.length).toBeGreaterThan(0);
  });

  it("refuses live mode when the secret is missing", async () => {
    const app = createApp();
    const response = await app.request("http://local/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "How do agents share state?", mode: "live" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("live_unavailable");
  });

  it("rate limits a second live run", async () => {
    const limiters = {
      ip: new TokenBucketLimiter({ capacity: 1, windowMs: 60_000, now: () => 0 }),
      global: new TokenBucketLimiter({ capacity: 4, windowMs: 60_000, now: () => 0 }),
    };
    const app = createApp({
      limiters,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "stopped in test" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    });
    const env = { GROQ_API_KEY: "test-key" };
    const body = JSON.stringify({ topic: "How do agents share state?", mode: "live", pace: "instant" });
    const headers = { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" };
    const first = await app.request("http://local/api/runs", { method: "POST", headers, body }, env);
    expect(first.status).toBe(200);
    const second = await app.request("http://local/api/runs", { method: "POST", headers, body }, env);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    await first.body?.cancel();
  });

  it("rejects a short assignment", async () => {
    const app = createApp();
    const response = await app.request("http://local/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "short" }),
    });
    expect(response.status).toBe(400);
  });
});

function parseSse(body: string): CrewEvent[] {
  const events: CrewEvent[] = [];
  const parser = createSseParser((data) => {
    events.push(JSON.parse(data) as CrewEvent);
  });
  parser.push(body);
  parser.flush();
  return events;
}
