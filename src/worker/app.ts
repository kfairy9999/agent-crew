import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { isAbort } from "../core/abort";
import { emptyUsage } from "../core/budget";
import { paceEvents, type Pace } from "../core/pace";
import { TokenBucketLimiter } from "../core/rate-limit";
import { runBodySchema } from "../core/schemas";
import { PRESETS } from "../demo/presets";
import { redactText } from "../persist/redact";
import { FIXTURE_CORPUS, getFixture } from "../tools/corpus";
import { handleArchiveGet, handleArchiveList, handleArchivePut } from "./archive";
import { mongoConfigured, readSettings, type WorkerBindings } from "./bindings";
import { renderFixturePage } from "./fixture-page";
import { limitersFor } from "./limiters";
import { archiveFromEnv, type MongoConnector } from "./mongo";
import { startCrew } from "./run";

export interface AppOptions {
  limiters?: { ip: TokenBucketLimiter; global: TokenBucketLimiter };
  fetchImpl?: typeof fetch;
  /** Test seam. Production uses the MongoDB driver only when `MONGODB_URI` is set. */
  mongoConnect?: MongoConnector;
}

export function createApp(options: AppOptions = {}): Hono<{ Bindings: WorkerBindings }> {
  const app = new Hono<{ Bindings: WorkerBindings }>();

  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        message: "unhandled",
        error: redactText(error instanceof Error ? error.message : String(error)),
      }),
    );
    return c.json({ error: "The desk hit an unexpected error.", code: "internal" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/config", (c) => {
    const settings = readSettings(c.env);
    return c.json({
      liveAvailable: settings.liveAvailable,
      demoDefault: true,
      provider: "groq",
      model: settings.model,
      baseUrl: settings.baseUrl,
      maxRevisions: settings.maxRevisions,
      budget: settings.budget,
      price: settings.price,
      rateLimit: {
        liveRunsPerWindow: settings.liveCapacity,
        globalRunsPerWindow: settings.globalCapacity,
        windowSeconds: Math.round(settings.liveWindowMs / 1000),
      },
      archive: {
        browser: "indexeddb",
        server: mongoConfigured(c.env) ? "mongodb" : null,
      },
      presets: PRESETS,
    });
  });

  app.get("/api/archive/runs", (c) => handleArchiveList(c, archiveFromEnv(c.env, options.mongoConnect)));
  app.get("/api/archive/runs/:id", (c) => handleArchiveGet(c, archiveFromEnv(c.env, options.mongoConnect)));
  app.put("/api/archive/runs/:id", (c) => handleArchivePut(c, archiveFromEnv(c.env, options.mongoConnect)));

  app.get("/api/fixtures", (c) =>
    c.json(FIXTURE_CORPUS.map((doc) => ({ id: doc.id, title: doc.title }))),
  );

  app.get("/api/fixtures/:id", (c) => {
    const doc = getFixture(c.req.param("id"));
    if (!doc) return c.json({ error: "Unknown fixture.", code: "not_found" }, 404);
    if (c.req.header("accept")?.includes("text/html")) return c.html(renderFixturePage(doc));
    return c.json(doc);
  });

  app.post("/api/runs", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 8_000) {
      return c.json({ error: "Request body is too large.", code: "bad_request" }, 413);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return c.json({ error: "Expected a JSON body.", code: "bad_request" }, 400);
    }
    const parsed = runBodySchema.safeParse(payload);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "bad_request" },
        400,
      );
    }

    const settings = readSettings(c.env);
    if (parsed.data.mode === "live" && !settings.liveAvailable) {
      return c.json(
        {
          error: "Live mode is off because GROQ_API_KEY is not set. Demo mode does not call a model.",
          code: "live_unavailable",
        },
        403,
      );
    }
    if (parsed.data.mode === "live") {
      const limiters = options.limiters ?? limitersFor(settings);
      const ipDecision = limiters.ip.take(`ip:${clientKey(c)}`);
      if (!ipDecision.allowed) return tooMany(c, ipDecision.retryAfterMs);
      const globalDecision = limiters.global.take("global");
      if (!globalDecision.allowed) return tooMany(c, globalDecision.retryAfterMs);
    }

    const runId = crypto.randomUUID();
    const topic = parsed.data.topic;
    const mode = parsed.data.mode;
    const pace: Pace = parsed.data.pace;
    console.log(JSON.stringify({ message: "run_started", runId, mode, topicLength: topic.length }));

    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    const signal = c.req.raw.signal;

    return streamSSE(c, async (stream) => {
      const paced = paceEvents(
        startCrew({
          topic,
          mode,
          settings,
          runId,
          signal,
          fetchImpl: options.fetchImpl,
        }),
        {
          pace,
          signal,
          sleep: (ms) => abortableSleep(ms, signal),
        },
      );
      try {
        for await (const event of paced) {
          if (stream.aborted || signal.aborted) return;
          await stream.writeSSE({ event: "crew", data: JSON.stringify(event) });
          if (event.type === "run_finished") {
            console.log(
              JSON.stringify({
                message: "run_finished",
                runId,
                status: event.status,
                tokens: event.usage.totalTokens,
                calls: event.usage.calls,
              }),
            );
          }
        }
      } catch (error) {
        if (isAbort(error) || stream.aborted) return;
        console.error(
          JSON.stringify({
            message: "run_failed",
            runId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        if (!stream.aborted) {
          await stream.writeSSE({
            event: "crew",
            data: JSON.stringify({ type: "error", message: "The crew stopped because a step failed." }),
          });
          await stream.writeSSE({
            event: "crew",
            data: JSON.stringify({ type: "run_finished", status: "failed", usage: emptyUsage() }),
          });
        }
      }
    });
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Not found.", code: "not_found" }, 404);
    }
    return c.text("Not found", 404);
  });

  return app;
}

function tooMany(c: Context, retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return c.json(
    {
      error: `Live mode is rate limited. Try again in ${seconds}s.`,
      code: "rate_limited",
      retryAfterSeconds: seconds,
    },
    429,
    { "retry-after": String(seconds) },
  );
}

function clientKey(c: Context): string {
  const cf = c.req.header("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
