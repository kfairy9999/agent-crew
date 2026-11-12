import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { createApp } from "../worker/app";
import { BINDING_KEYS, isBindingKey, mongoConfigured, type WorkerBindings } from "../worker/bindings";

const port = Number(process.env.PORT ?? 44731);
const env = loadLocalEnv();
const app = createApp();

if (process.env.SERVE_STATIC === "1") {
  app.use("/*", serveStatic({ root: "./dist/client", index: "index.html" }));
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Not found.", code: "not_found" }, 404);
    }
    const file = await serveStatic({ path: "./dist/client/index.html" })(c, next);
    return file ?? c.text("Not found", 404);
  });
}

serve(
  {
    fetch: (request) => app.fetch(request, env),
    port,
    hostname: "127.0.0.1",
  },
  (info) => {
    console.log(
      JSON.stringify({
        message: "listening",
        port: info.port,
        static: process.env.SERVE_STATIC === "1",
        liveAvailable: Boolean(env.GROQ_API_KEY?.trim()),
        archive: mongoConfigured(env) ? "mongodb" : "indexeddb",
      }),
    );
  },
);

function loadLocalEnv(): WorkerBindings {
  const loaded: WorkerBindings = {};
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!isBindingKey(key)) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      loaded[key] = value;
    }
  }
  for (const key of BINDING_KEYS) {
    const value = process.env[key];
    if (value) loaded[key] = value;
  }
  return loaded;
}
