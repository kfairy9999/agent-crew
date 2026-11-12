import type { Context } from "hono";
import { ARCHIVE_BODY_LIMIT, LIST_LIMIT, parseStoredRun } from "../persist/document";
import { ownerIdForKey, readOwnerKeyHeader } from "../persist/owner";
import { redactText } from "../persist/redact";
import type { WorkerBindings } from "./bindings";
import type { RunArchive } from "./mongo";

type AppContext = Context<{ Bindings: WorkerBindings }>;

export async function handleArchiveList(c: AppContext, archive: RunArchive): Promise<Response> {
  if (!archive.remote) return off(c);
  const ownerId = await requireOwner(c);
  if (ownerId instanceof Response) return ownerId;
  try {
    const runs = await archive.list(ownerId, LIST_LIMIT);
    return json(c, { runs }, 200);
  } catch (error) {
    return failed(c, error);
  }
}

export async function handleArchiveGet(c: AppContext, archive: RunArchive): Promise<Response> {
  if (!archive.remote) return off(c);
  const ownerId = await requireOwner(c);
  if (ownerId instanceof Response) return ownerId;
  const id = c.req.param("id") ?? "";
  if (!isRunId(id)) return json(c, { error: "Unknown run id.", code: "bad_request" }, 400);
  try {
    const record = await archive.get(ownerId, id);
    if (!record) return json(c, { error: "No saved run with that id.", code: "not_found" }, 404);
    return json(c, record, 200);
  } catch (error) {
    return failed(c, error);
  }
}

export async function handleArchivePut(c: AppContext, archive: RunArchive): Promise<Response> {
  if (!archive.remote) return off(c);
  const ownerId = await requireOwner(c);
  if (ownerId instanceof Response) return ownerId;
  const id = c.req.param("id") ?? "";
  if (!isRunId(id)) return json(c, { error: "Unknown run id.", code: "bad_request" }, 400);
  const raw = await c.req.text();
  if (raw.length > ARCHIVE_BODY_LIMIT) {
    return json(c, { error: "Saved run is too large.", code: "too_large" }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return json(c, { error: "Expected a JSON body.", code: "bad_request" }, 400);
  }
  const parsed = parseStoredRun(payload, ownerId);
  if (!parsed.ok || parsed.record.id !== id) {
    console.error(JSON.stringify({ message: "archive_rejected", reason: parsed.ok ? "id" : parsed.reason }));
    return json(c, { error: "The saved run is not valid.", code: "bad_request" }, 400);
  }
  try {
    await archive.save(ownerId, parsed.record);
    return json(c, { ok: true, id }, 200);
  } catch (error) {
    return failed(c, error);
  }
}

async function requireOwner(c: AppContext): Promise<string | Response> {
  const key = readOwnerKeyHeader((name) => c.req.header(name));
  if (!key) {
    return json(c, { error: "An owner key is required to read or save runs.", code: "unauthorized" }, 401);
  }
  return ownerIdForKey(key);
}

function off(c: AppContext): Response {
  return json(
    c,
    {
      error: "This desk stores runs in the browser. Set MONGODB_URI to turn on the server archive.",
      code: "archive_off",
    },
    404,
  );
}

function failed(c: AppContext, error: unknown): Response {
  const name = error instanceof Error ? error.name : "";
  if (name === "DuplicateRunError") {
    return json(c, { error: "That run is already stored for another owner.", code: "conflict" }, 409);
  }
  if (name === "ArchiveReadError") {
    return json(c, { error: "The saved run could not be read.", code: "corrupt" }, 422);
  }
  console.error(
    JSON.stringify({
      message: "archive_failed",
      error: redactText(error instanceof Error ? error.message : String(error)),
    }),
  );
  return json(c, { error: "The run archive could not be reached.", code: "archive_unavailable" }, 503);
}

function json(c: AppContext, body: unknown, status: 200 | 400 | 401 | 404 | 409 | 413 | 422 | 503): Response {
  return c.json(body, status, { "cache-control": "no-store" });
}

function isRunId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
