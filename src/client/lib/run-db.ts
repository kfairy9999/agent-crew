import { createOwnerKey, ownerIdForKey } from "../../persist/owner";
import { LIST_LIMIT, parseStoredRun, toSummary, type RunRecord, type RunSummary } from "../../persist/document";

export const RUN_DB_NAME = "agent-crew";
const DB_VERSION = 1;
const OWNER_META = "ownerKey";

export const STORAGE_MESSAGE =
  "This browser can't store runs (private browsing or a full quota). The crew on screen still works. A refresh will clear it.";

const STORAGE_NAMES = new Set([
  "SecurityError",
  "QuotaExceededError",
  "UnknownError",
  "InvalidStateError",
  "NotSupportedError",
  "AbortError",
]);

export interface RunDatabase {
  save(record: RunRecord): Promise<void>;
  get(id: string): Promise<RunRecord | null>;
  list(limit?: number): Promise<RunSummary[]>;
  ownerKey(): Promise<string>;
}

const openings = new Map<string, Promise<RunDatabase>>();

export function openRunDatabase(name = RUN_DB_NAME): Promise<RunDatabase> {
  const existing = openings.get(name);
  if (existing) return existing;
  const pending = connect(name).catch((error: unknown) => {
    openings.delete(name);
    throw error;
  });
  openings.set(name, pending);
  return pending;
}

export function forgetRunDatabase(name = RUN_DB_NAME): void {
  openings.delete(name);
}

export function storageErrorMessage(error: unknown): string | null {
  const name = error instanceof Error ? error.name : "";
  if (STORAGE_NAMES.has(name)) return STORAGE_MESSAGE;
  if (error instanceof Error && /indexeddb|quota|private browsing/i.test(error.message)) return STORAGE_MESSAGE;
  return null;
}

async function connect(name: string): Promise<RunDatabase> {
  const db = await openDatabase(name);
  let keyPromise: Promise<string> | null = null;
  const ownerKey = (): Promise<string> => {
    keyPromise ??= readOrCreateOwnerKey(db);
    return keyPromise;
  };
  return {
    ownerKey,
    async save(record) {
      await putRecord(db, record);
    },
    async get(id) {
      const ownerId = await ownerIdForKey(await ownerKey());
      const item = await getRecord(db, id);
      if (!sameOwner(item, ownerId)) return null;
      const parsed = parseStoredRun(item, ownerId);
      return parsed.ok ? parsed.record : null;
    },
    async list(limit = LIST_LIMIT) {
      const ownerId = await ownerIdForKey(await ownerKey());
      const all = await getAll(db);
      const summaries: RunSummary[] = [];
      for (const item of all) {
        if (!sameOwner(item, ownerId)) continue;
        const parsed = parseStoredRun(item, ownerId);
        if (!parsed.ok) continue;
        summaries.push(toSummary(parsed.record));
      }
      summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
      return summaries.slice(0, limit);
    },
  };
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new DOMException("IndexedDB is not available in this browser.", "SecurityError"));
      return;
    }
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("runs")) {
        const store = database.createObjectStore("runs", { keyPath: "id" });
        store.createIndex("byUpdatedAt", "updatedAt");
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DOMException("IndexedDB could not be opened.", "UnknownError"));
    request.onblocked = () => reject(new DOMException("IndexedDB open is blocked.", "InvalidStateError"));
  });
}

async function readOrCreateOwnerKey(db: IDBDatabase): Promise<string> {
  const existing = await getMeta(db, OWNER_META);
  if (typeof existing === "string" && /^[a-f0-9]{64}$/.test(existing)) return existing;
  const created = createOwnerKey();
  await putMeta(db, OWNER_META, created);
  return created;
}

function putRecord(db: IDBDatabase, record: RunRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("runs", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException("IndexedDB transaction aborted.", "AbortError"));
    tx.onerror = () => reject(tx.error ?? new DOMException("IndexedDB transaction failed.", "UnknownError"));
    tx.objectStore("runs").put(JSON.parse(JSON.stringify(record)) as RunRecord);
  });
}

function getRecord(db: IDBDatabase, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction("runs", "readonly").objectStore("runs").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DOMException("IndexedDB read failed.", "UnknownError"));
  });
}

function getAll(db: IDBDatabase): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction("runs", "readonly").objectStore("runs").getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error ?? new DOMException("IndexedDB read failed.", "UnknownError"));
  });
}

function getMeta(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction("meta", "readonly").objectStore("meta").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DOMException("IndexedDB read failed.", "UnknownError"));
  });
}

function putMeta(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException("IndexedDB transaction aborted.", "AbortError"));
    tx.onerror = () => reject(tx.error ?? new DOMException("IndexedDB transaction failed.", "UnknownError"));
    tx.objectStore("meta").put(value, key);
  });
}

function sameOwner(value: unknown, ownerId: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (value as { ownerId?: unknown }).ownerId === ownerId;
}
