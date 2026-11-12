import { useCallback, useEffect, useRef, useState } from "react";
import type { Blackboard } from "../../core/types";
import {
  buildRunRecord,
  isRunSummary,
  mergeSummaries,
  parseStoredRun,
  snapshotDelay,
  toSummary,
  type RunRecord,
  type RunSummary,
} from "../../persist/document";
import { createOwnerKey, ownerIdForKey } from "../../persist/owner";
import { openRunDatabase, STORAGE_MESSAGE, storageErrorMessage, type RunDatabase } from "./run-db";

export function useRunArchive(options: {
  state: Blackboard;
  running: boolean;
  remote: boolean | null;
  onOpen: (record: RunRecord) => void;
}) {
  const { state, running, remote, onOpen } = options;
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reopened, setReopened] = useState(false);
  const [remoteOff, setRemoteOff] = useState(false);

  const latest = useRef(state);
  latest.current = state;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const remoteRef = useRef(false);
  remoteRef.current = remote === true && !remoteOff;
  const runningRef = useRef(running);
  runningRef.current = running;
  const dbRef = useRef<RunDatabase | null>(null);
  const localOff = useRef(false);
  const memoryKey = useRef<string | null>(null);
  const opening = useRef<Promise<RunDatabase | null> | null>(null);
  const timestamps = useRef(new Map<string, { createdAt: string; finishedAt: string | null }>());
  const restoredJson = useRef<string | null>(null);
  const localChain = useRef(Promise.resolve());
  const remoteChain = useRef(Promise.resolve());

  const ensureDb = useCallback((): Promise<RunDatabase | null> => {
    opening.current ??= openRunDatabase()
      .then((db) => {
        dbRef.current = db;
        return db;
      })
      .catch((error: unknown) => {
        localOff.current = true;
        setStorageError(storageErrorMessage(error) ?? STORAGE_MESSAGE);
        return null;
      });
    return opening.current;
  }, []);

  const keyFor = useCallback(async (db: RunDatabase | null): Promise<string> => {
    if (db && !localOff.current) {
      try {
        return await db.ownerKey();
      } catch (error) {
        localOff.current = true;
        setStorageError(storageErrorMessage(error) ?? STORAGE_MESSAGE);
      }
    }
    memoryKey.current ??= createOwnerKey();
    return memoryKey.current;
  }, []);

  const pushRemote = useCallback(async (key: string, record: RunRecord, localSaved: boolean): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(`/api/archive/runs/${encodeURIComponent(record.id)}`, {
        method: "PUT",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-owner-key": key,
        },
        body: JSON.stringify(record),
        cache: "no-store",
      });
    } catch {
      throw new Error(remoteErrorFor(0, localSaved));
    }
    if (response.ok) {
      setRemoteError(null);
      return;
    }
    const payload = await readPayload(response);
    if (payload.code === "archive_off") {
      setRemoteOff(true);
      return;
    }
    throw new Error(remoteErrorFor(response.status, localSaved));
  }, []);

  const writeLocal = useCallback(
    async (board: Blackboard): Promise<void> => {
      if (!board.runId) return;
      if (restoredJson.current && restoredJson.current === JSON.stringify(board)) return;
      const db = await ensureDb();
      const key = await keyFor(db);
      const ownerId = await ownerIdForKey(key);
      let previous = timestamps.current.get(board.runId) ?? null;
      if (!previous && db && !localOff.current) {
        try {
          const existing = await db.get(board.runId);
          if (existing) previous = { createdAt: existing.createdAt, finishedAt: existing.finishedAt };
        } catch (error) {
          localOff.current = true;
          setStorageError(storageErrorMessage(error) ?? STORAGE_MESSAGE);
        }
      }
      const record = buildRunRecord(board, ownerId, previous);
      if (!record) {
        setSaveError("This run could not be saved on this desk.");
        return;
      }
      timestamps.current.set(record.id, { createdAt: record.createdAt, finishedAt: record.finishedAt });
      let localSaved = false;
      if (db && !localOff.current) {
        try {
          await db.save(record);
          localSaved = true;
          setStorageError(null);
        } catch (error) {
          localOff.current = true;
          setStorageError(storageErrorMessage(error) ?? STORAGE_MESSAGE);
        }
      }
      setRuns((current) => mergeSummaries(current, [toSummary(record)]));
      setSaveError(null);
      if (remoteRef.current) {
        remoteChain.current = remoteChain.current
          .then(() => pushRemote(key, record, localSaved))
          .catch((error: unknown) => {
            setRemoteError(error instanceof Error ? error.message : remoteErrorFor(0, localSaved));
          });
      }
    },
    [ensureDb, keyFor, pushRemote],
  );

  const enqueue = useCallback(
    (board: Blackboard) => {
      const snapshot = board;
      localChain.current = localChain.current.then(() => writeLocal(snapshot)).catch(() => undefined);
    },
    [writeLocal],
  );

  useEffect(() => {
    if (running) {
      restoredJson.current = null;
      setReopened(false);
    }
  }, [running]);

  useEffect(() => {
    if (!state.runId) return;
    if (restoredJson.current && restoredJson.current === JSON.stringify(state)) return;
    restoredJson.current = null;
    const handle = window.setTimeout(() => enqueue(state), snapshotDelay(state.status));
    return () => window.clearTimeout(handle);
  }, [state, enqueue]);

  useEffect(() => {
    if (remote !== true || remoteOff) return;
    if (latest.current.runId) enqueue(latest.current);
  }, [remote, remoteOff, enqueue]);

  useEffect(() => {
    const flush = () => {
      const board = latest.current;
      if (!board.runId) return;
      enqueue(board);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [enqueue]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await ensureDb();
      if (cancelled) return;
      if (db && !localOff.current) {
        try {
          const listed = await db.list();
          if (!cancelled) setRuns((current) => mergeSummaries(current, listed));
        } catch (error) {
          localOff.current = true;
          if (!cancelled) setStorageError(storageErrorMessage(error) ?? STORAGE_MESSAGE);
        }
      }
      if (!cancelled) setReady(true);
      if (!cancelled && remoteRef.current) {
        try {
          const key = await keyFor(db);
          const remoteRuns = await fetchRemoteList(key, () => setRemoteOff(true));
          if (!cancelled) setRuns((current) => mergeSummaries(current, remoteRuns));
        } catch (error) {
          if (!cancelled) setRemoteError(error instanceof Error ? error.message : remoteErrorFor(0, true));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remote, remoteOff, ensureDb, keyFor]);

  const openRun = useCallback(
    async (id: string) => {
      if (runningRef.current) return;
      const db = await ensureDb();
      const key = await keyFor(db);
      let local: RunRecord | null = null;
      if (db && !localOff.current) {
        try {
          local = await db.get(id);
        } catch (error) {
          localOff.current = true;
          setStorageError(storageErrorMessage(error) ?? STORAGE_MESSAGE);
        }
      }
      let remoteRecord: RunRecord | null = null;
      if (remoteRef.current) {
        try {
          remoteRecord = await fetchRemoteRun(key, id, () => setRemoteOff(true));
        } catch (error) {
          setRemoteError(error instanceof Error ? error.message : remoteErrorFor(0, Boolean(local)));
        }
      }
      const chosen = pickNewer(local, remoteRecord);
      if (!chosen) {
        setSaveError("This saved run could not be read.");
        return;
      }
      timestamps.current.set(chosen.id, { createdAt: chosen.createdAt, finishedAt: chosen.finishedAt });
      restoredJson.current = JSON.stringify(chosen.blackboard);
      setReopened(true);
      setSaveError(null);
      onOpenRef.current(chosen);
      if (db && !localOff.current && chosen !== local) {
        try {
          await db.save(chosen);
        } catch (error) {
          localOff.current = true;
          setStorageError(storageErrorMessage(error) ?? STORAGE_MESSAGE);
        }
      }
      if (remoteRef.current && local && (!remoteRecord || local.updatedAt > remoteRecord.updatedAt)) {
        void pushRemote(key, local, true).catch((error: unknown) => {
          setRemoteError(error instanceof Error ? error.message : remoteErrorFor(0, true));
        });
      }
    },
    [ensureDb, keyFor, pushRemote],
  );

  return {
    runs,
    ready,
    storageError,
    remoteError,
    saveError,
    reopened,
    remote: remote === true && !remoteOff,
    openRun,
  };
}

function pickNewer(local: RunRecord | null, remote: RunRecord | null): RunRecord | null {
  if (local && remote) return local.updatedAt >= remote.updatedAt ? local : remote;
  return local ?? remote;
}

function remoteErrorFor(status: number, localSaved: boolean): string {
  if (status === 401) return "The server archive refused this browser's owner key. Runs stay in this browser.";
  if (localSaved) return "The server archive didn't take this run. It is still saved in this browser.";
  return "The server archive didn't take this run. It remains on screen for this visit.";
}

async function fetchRemoteList(key: string, onOff: () => void): Promise<RunSummary[]> {
  const response = await fetch("/api/archive/runs", {
    headers: { accept: "application/json", "x-owner-key": key },
    cache: "no-store",
  });
  const payload = await readPayload(response);
  if (payload.code === "archive_off") {
    onOff();
    return [];
  }
  if (!response.ok) throw new Error(remoteErrorFor(response.status, true));
  if (!Array.isArray(payload.runs)) return [];
  return payload.runs.filter(isRunSummary);
}

async function fetchRemoteRun(key: string, id: string, onOff: () => void): Promise<RunRecord | null> {
  const response = await fetch(`/api/archive/runs/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json", "x-owner-key": key },
    cache: "no-store",
  });
  const payload = await readPayload(response);
  if (payload.code === "archive_off") {
    onOff();
    return null;
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(remoteErrorFor(response.status, true));
  const ownerId = await ownerIdForKey(key);
  const parsed = parseStoredRun(payload, ownerId);
  return parsed.ok ? parsed.record : null;
}

async function readPayload(response: Response): Promise<{ error?: string; code?: string; runs?: unknown }> {
  try {
    return (await response.json()) as { error?: string; code?: string; runs?: unknown };
  } catch {
    return {};
  }
}
