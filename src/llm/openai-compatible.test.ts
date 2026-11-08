import { describe, expect, it } from "vitest";
import type { LlmRequest } from "../core/types";
import { DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL, USER_AGENT } from "./constants";
import { LlmError, OpenAICompatibleClient } from "./openai-compatible";

const request: LlmRequest = {
  agent: "planner",
  messages: [
    { role: "system", content: "Return JSON." },
    { role: "user", content: "Topic." },
  ],
  temperature: 0.2,
  maxTokens: 200,
};

describe("OpenAICompatibleClient", () => {
  it("targets Groq with an explicit user agent", async () => {
    const seen: { url: string; headers: Headers; body: { model?: string } }[] = [];
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      fetchImpl: async (input, init) => {
        seen.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as { model?: string },
        });
        return json({
          choices: [{ message: { content: "{\"ok\":true}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        });
      },
    });
    const result = await client.complete(request);
    expect(seen[0]?.url).toBe(`${DEFAULT_GROQ_BASE_URL}/chat/completions`);
    expect(seen[0]?.headers.get("user-agent")).toBe(USER_AGENT);
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer test-key");
    expect(seen[0]?.body.model).toBe(DEFAULT_GROQ_MODEL);
    expect(DEFAULT_GROQ_MODEL).toBe("qwen/qwen3.8-27b");
    expect(result.promptTokens).toBe(10);
    expect(result.content).toContain("ok");
  });

  it("retries 429 using the longer token-bucket reset", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("try again", {
            status: 429,
            headers: {
              "retry-after": "1",
              "x-ratelimit-reset-tokens": "5s",
            },
          });
        }
        return json({
          choices: [{ message: { content: "{\"ok\":true}" } }],
          usage: { prompt_tokens: 3, completion_tokens: 3 },
        });
      },
    });
    await client.complete(request);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([5000]);
  });

  it("refuses to block past the wait cap", async () => {
    let slept = 0;
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      maxRetryWaitMs: 15_000,
      sleep: async () => {
        slept += 1;
      },
      fetchImpl: async () =>
        new Response("slow", {
          status: 429,
          headers: { "x-ratelimit-reset-tokens": "10m" },
        }),
    });
    await expect(client.complete(request)).rejects.toBeInstanceOf(LlmError);
    expect(slept).toBe(0);
  });

  it("drops json mode when the model rejects response_format", async () => {
    const formats: unknown[] = [];
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { response_format?: unknown };
        formats.push(body.response_format ?? null);
        if (body.response_format) {
          return new Response("response_format is not supported", { status: 400 });
        }
        return json({
          choices: [{ message: { content: "{\"ok\":true}" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      },
    });
    await client.complete(request);
    expect(formats).toEqual([{ type: "json_object" }, null]);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
