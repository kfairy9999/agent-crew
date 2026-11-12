import { mongoDbName, type WorkerBindings } from "./bindings";
import {
  fromMongoDocument,
  parseStoredRun,
  toMongoDocument,
  toSummary,
  type RunDocument,
  type RunRecord,
  type RunSummary,
} from "../persist/document";
import { redactError, redactText } from "../persist/redact";

export interface RunCursor {
  sort(spec: { updatedAt: -1 }): RunCursor;
  limit(count: number): RunCursor;
  toArray(): Promise<RunDocument[]>;
}

export interface RunCollection {
  replaceOne(
    filter: { _id: string; ownerId: string },
    replacement: RunDocument,
    options: { upsert: true },
  ): Promise<unknown>;
  find(filter: { ownerId: string }): RunCursor;
  findOne(filter: { _id: string; ownerId: string }): Promise<RunDocument | null>;
}

export interface MongoSession {
  collection: RunCollection;
  close(): Promise<void>;
}

export type MongoConnector = (uri: string, dbName: string) => Promise<MongoSession>;

export interface RunArchive {
  readonly remote: boolean;
  save(ownerId: string, record: RunRecord): Promise<void>;
  list(ownerId: string, limit: number): Promise<RunSummary[]>;
  get(ownerId: string, id: string): Promise<RunRecord | null>;
}

const browserOnly: RunArchive = {
  remote: false,
  save() {
    return Promise.reject(new Error("archive_off"));
  },
  list() {
    return Promise.reject(new Error("archive_off"));
  },
  get() {
    return Promise.reject(new Error("archive_off"));
  },
};

export function archiveFromEnv(env: WorkerBindings | undefined, connect?: MongoConnector): RunArchive {
  const uri = env?.MONGODB_URI?.trim() ?? "";
  if (!uri) return browserOnly;
  return createMongoArchive({ uri, dbName: mongoDbName(env), connect: connect ?? defaultMongoConnector });
}

export function createMongoArchive(options: { uri: string; dbName: string; connect: MongoConnector }): RunArchive {
  const { uri, dbName, connect } = options;
  return {
    remote: true,
    async save(ownerId, record) {
      const doc = toMongoDocument({ ...record, ownerId });
      await withCollection(uri, dbName, connect, (collection) =>
        collection.replaceOne({ _id: doc._id, ownerId }, doc, { upsert: true }),
      );
    },
    async list(ownerId, limit) {
      const docs = await withCollection(uri, dbName, connect, (collection) =>
        collection.find({ ownerId }).sort({ updatedAt: -1 }).limit(limit).toArray(),
      );
      const summaries: RunSummary[] = [];
      for (const doc of docs) {
        const parsed = parseStoredRun(fromMongoDocument(doc), ownerId);
        if (parsed.ok) summaries.push(toSummary(parsed.record));
      }
      return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },
    async get(ownerId, id) {
      const doc = await withCollection(uri, dbName, connect, (collection) => collection.findOne({ _id: id, ownerId }));
      if (!doc) return null;
      const parsed = parseStoredRun(fromMongoDocument(doc), ownerId);
      if (!parsed.ok) {
        const error = new Error("Stored run could not be read.");
        error.name = "ArchiveReadError";
        throw error;
      }
      return parsed.record;
    },
  };
}

export async function defaultMongoConnector(uri: string, dbName: string): Promise<MongoSession> {
  try {
    const driver = await import("./mongo-driver");
    return await driver.connectRuns(uri, dbName);
  } catch (error) {
    throw redactError(error, uri);
  }
}

async function withCollection<T>(
  uri: string,
  dbName: string,
  connect: MongoConnector,
  run: (collection: RunCollection) => Promise<T>,
): Promise<T> {
  let session: MongoSession | undefined;
  try {
    session = await connect(uri, dbName);
    return await run(session.collection);
  } catch (error) {
    throw asArchiveError(error, uri);
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "mongo_close_failed",
            error: redactText(error instanceof Error ? error.message : String(error), uri),
          }),
        );
      }
    }
  }
}

function asArchiveError(error: unknown, uri: string): Error {
  if (isDuplicateKey(error)) {
    const wrapped = redactError(error, uri);
    wrapped.name = "DuplicateRunError";
    return wrapped;
  }
  if (error instanceof Error && error.name === "ArchiveReadError") return error;
  return redactError(error, uri);
}

function isDuplicateKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && (error as { code?: unknown }).code === 11000) return true;
  return error instanceof Error && (error.name === "DuplicateRunError" || error.message.includes("E11000"));
}
