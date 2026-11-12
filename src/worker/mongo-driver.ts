import { MongoClient, type Document } from "mongodb";
import type { RunDocument } from "../persist/document";
import type { MongoSession, RunCollection, RunCursor } from "./mongo";

/**
 * Static driver import. `mongo.ts` loads this module with a dynamic import
 * only while handling an archive request when `MONGODB_URI` is set.
 * The Worker entry does not import it, so a demo isolate never evaluates the driver.
 */
export async function connectRuns(uri: string, dbName: string): Promise<MongoSession> {
  // The worker tsconfig does not load @types/node globals, and the driver's TLS
  // option bag then fails to typecheck. These fields are valid MongoClientOptions.
  const client = new MongoClient(uri, {
    appName: "agent-crew",
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    maxPoolSize: 1,
  } as never);
  try {
    await client.connect();
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  const collection = client.db(dbName).collection<Document>("runs");
  return {
    collection: adapt(collection),
    close: async () => {
      await client.close();
    },
  };
}

interface DriverCursor {
  sort(spec: Document): DriverCursor;
  limit(count: number): DriverCursor;
  toArray(): Promise<Document[]>;
}

function adapt(collection: {
  replaceOne(filter: Document, replacement: Document, options: { upsert: boolean }): Promise<unknown>;
  find(filter: Document): DriverCursor;
  findOne(filter: Document): Promise<Document | null>;
}): RunCollection {
  return {
    replaceOne(filter, replacement, options) {
      return collection.replaceOne(filter, replacement, options);
    },
    find(filter) {
      let query = collection.find(filter);
      const chain: RunCursor = {
        sort(spec) {
          query = query.sort(spec);
          return chain;
        },
        limit(count) {
          query = query.limit(count);
          return chain;
        },
        async toArray() {
          const docs = await query.toArray();
          return docs as RunDocument[];
        },
      };
      return chain;
    },
    async findOne(filter) {
      const doc = await collection.findOne(filter);
      return doc ? (doc as RunDocument) : null;
    },
  };
}
