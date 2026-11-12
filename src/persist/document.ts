import { AGENTS, type AgentId, type AgentStatus, type Blackboard, type Budget, type CrewEvent, type Plan, type Report, type RunMode, type RunStatus, type Source, type Usage } from "../core/types";
import { z } from "zod";

export const ARCHIVE_BODY_LIMIT = 750_000;
export const LIST_LIMIT = 30;

export interface PublicArchiveConfig {
  browser: "indexeddb";
  server: "mongodb" | null;
}

export interface RunRecord {
  id: string;
  ownerId: string;
  topic: string;
  mode: RunMode;
  status: RunStatus;
  model: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  usage: Usage;
  budget: Budget;
  blackboard: Blackboard;
}

export interface RunSummary {
  id: string;
  topic: string;
  mode: RunMode;
  status: RunStatus;
  model: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  totalTokens: number;
  costUsd: number;
  calls: number;
  sourceCount: number;
  eventCount: number;
}

/** MongoDB document. `_id` is the run id. `ownerId` is the hash of the browser key. */
export interface RunDocument {
  _id: string;
  ownerId: string;
  topic: string;
  mode: RunMode;
  status: RunStatus;
  model: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  usage: Usage;
  budget: Budget;
  eventCount: number;
  sourceCount: number;
  blackboard: Blackboard;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const OWNER_ID = /^[a-f0-9]{64}$/;

const RUN_STATUSES = ["pending", "running", "complete", "budget_exceeded", "failed", "stopped"] as const;
const AGENT_STATUSES = ["idle", "planning", "searching", "reading", "drafting", "revising", "reviewing", "done", "blocked"] as const;
const PHASES = ["idle", "planning", "researching", "writing", "critiquing", "revising", "done"] as const;

const usageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  calls: z.number().int().nonnegative(),
});

const budgetSchema = z.object({
  maxTokens: z.number().int().positive(),
  maxCostUsd: z.number().positive(),
});

const envelopeSchema = z.object({
  id: z.string().regex(UUID),
  topic: z.string().min(1).max(400),
  mode: z.enum(["demo", "live"]),
  status: z.enum(RUN_STATUSES),
  model: z.string().max(160),
  evidence: z.string().max(80),
  createdAt: z.string().regex(ISO),
  updatedAt: z.string().regex(ISO),
  finishedAt: z.string().regex(ISO).nullable(),
  usage: usageSchema,
  budget: budgetSchema,
  blackboard: z.unknown(),
});

export type ParseResult = { ok: true; record: RunRecord } | { ok: false; error: string; reason: string };

export function parseStoredRun(input: unknown, ownerId: string): ParseResult {
  if (!OWNER_ID.test(ownerId)) return fail("owner");
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) return fail("envelope");
  const reason = explainBlackboard(parsed.data.blackboard);
  if (reason) return fail(reason);
  const board = parsed.data.blackboard as Blackboard;
  if (board.runId !== parsed.data.id) return fail("runId");
  if (board.mode !== parsed.data.mode) return fail("mode");
  if (board.status !== parsed.data.status) return fail("status");
  if (board.model !== parsed.data.model) return fail("model");
  if (board.evidence !== parsed.data.evidence) return fail("evidence");
  if (board.topic !== parsed.data.topic) return fail("topic");
  if (!sameUsage(board.usage, parsed.data.usage)) return fail("usage");
  if (board.budget.maxTokens !== parsed.data.budget.maxTokens || board.budget.maxCostUsd !== parsed.data.budget.maxCostUsd) {
    return fail("budget");
  }
  const terminal = parsed.data.status !== "pending" && parsed.data.status !== "running";
  if (terminal && parsed.data.finishedAt === null) return fail("finishedAt");
  if (!terminal && parsed.data.finishedAt !== null) return fail("finishedAt");
  if (parsed.data.createdAt > parsed.data.updatedAt) return fail("updatedAt");
  if (parsed.data.finishedAt && parsed.data.finishedAt < parsed.data.createdAt) return fail("finishedAt");
  return {
    ok: true,
    record: {
      id: parsed.data.id,
      ownerId,
      topic: parsed.data.topic,
      mode: parsed.data.mode,
      status: parsed.data.status,
      model: parsed.data.model,
      evidence: parsed.data.evidence,
      createdAt: parsed.data.createdAt,
      updatedAt: parsed.data.updatedAt,
      finishedAt: parsed.data.finishedAt,
      usage: parsed.data.usage,
      budget: parsed.data.budget,
      blackboard: board,
    },
  };
}

export function buildRunRecord(
  board: Blackboard,
  ownerId: string,
  previous: { createdAt: string; finishedAt: string | null } | null,
  now = new Date().toISOString(),
): RunRecord | null {
  if (!board.runId) return null;
  const terminal = board.status !== "pending" && board.status !== "running";
  const createdAt = previous?.createdAt ?? now;
  const finishedAt = terminal ? (previous?.finishedAt ?? now) : null;
  const record: RunRecord = {
    id: board.runId,
    ownerId,
    topic: board.topic,
    mode: board.mode,
    status: board.status,
    model: board.model,
    evidence: board.evidence,
    createdAt,
    updatedAt: now,
    finishedAt,
    usage: board.usage,
    budget: board.budget,
    blackboard: board,
  };
  const parsed = parseStoredRun(record, ownerId);
  return parsed.ok ? parsed.record : null;
}

export function toSummary(record: RunRecord): RunSummary {
  return {
    id: record.id,
    topic: record.topic,
    mode: record.mode,
    status: record.status,
    model: record.model,
    evidence: record.evidence,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
    totalTokens: record.usage.totalTokens,
    costUsd: record.usage.costUsd,
    calls: record.usage.calls,
    sourceCount: record.blackboard.sources.length,
    eventCount: record.blackboard.events.length,
  };
}

export function toMongoDocument(record: RunRecord): RunDocument {
  return {
    _id: record.id,
    ownerId: record.ownerId,
    topic: record.topic,
    mode: record.mode,
    status: record.status,
    model: record.model,
    evidence: record.evidence,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
    usage: record.usage,
    budget: record.budget,
    eventCount: record.blackboard.events.length,
    sourceCount: record.blackboard.sources.length,
    blackboard: record.blackboard,
  };
}

export function fromMongoDocument(doc: RunDocument): RunRecord {
  return {
    id: doc._id,
    ownerId: doc.ownerId,
    topic: doc.topic,
    mode: doc.mode,
    status: doc.status,
    model: doc.model,
    evidence: doc.evidence,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    finishedAt: doc.finishedAt,
    usage: doc.usage,
    budget: doc.budget,
    blackboard: doc.blackboard,
  };
}

export function mergeSummaries(...groups: RunSummary[][]): RunSummary[] {
  const byId = new Map<string, RunSummary>();
  for (const group of groups) {
    for (const item of group) {
      const prev = byId.get(item.id);
      if (!prev || item.updatedAt >= prev.updatedAt) byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
}

/** Demo and fixture traces stay labeled Demo even if a stored mode says otherwise. */
export function runKindLabel(input: { mode: RunMode; model: string; evidence: string }): "Demo" | "Live" {
  if (input.mode !== "live") return "Demo";
  if (input.model === "demo-scripted" || input.evidence === "fixture-corpus") return "Demo";
  return "Live";
}

export function statusLabel(status: RunStatus): string {
  switch (status) {
    case "pending":
      return "Waiting";
    case "running":
      return "In progress";
    case "complete":
      return "Signed";
    case "budget_exceeded":
      return "Budget stop";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

export function runListDetail(run: Pick<RunSummary, "mode" | "model" | "evidence" | "status" | "updatedAt">, now = Date.now()): string {
  const kind = runKindLabel(run);
  const qualifier = kind === "Demo" ? "scripted" : run.model || "model";
  return `${kind} · ${qualifier} · ${statusLabel(run.status)} · ${formatSavedAt(run.updatedAt, now)}`;
}

export function reopenedCopy(input: { mode: RunMode; model: string; evidence: string; status: RunStatus }): string {
  const partial =
    input.status === "running" || input.status === "pending"
      ? " This is the last snapshot from a run that was still going."
      : "";
  if (runKindLabel(input) === "Demo") {
    return `Saved demo run. Scripted model, local corpus. Opening it does not call Groq.${partial}`;
  }
  return `Saved live run. Stored Groq trace. Opening it does not call the model again.${partial}`;
}

export function formatSavedAt(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "saved";
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(then));
}

export function snapshotDelay(status: RunStatus): number {
  return status === "pending" || status === "running" ? 400 : 0;
}

export function isRunSummary(value: unknown): value is RunSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.topic === "string" &&
    (value.mode === "demo" || value.mode === "live") &&
    typeof value.model === "string" &&
    typeof value.evidence === "string" &&
    isRunStatus(value.status) &&
    typeof value.updatedAt === "string" &&
    typeof value.createdAt === "string" &&
    (value.finishedAt === null || typeof value.finishedAt === "string") &&
    typeof value.totalTokens === "number" &&
    typeof value.costUsd === "number" &&
    typeof value.calls === "number" &&
    typeof value.sourceCount === "number" &&
    typeof value.eventCount === "number"
  );
}

function fail(reason: string): ParseResult {
  return { ok: false, error: "The saved run is not valid.", reason };
}

function sameUsage(a: Usage, b: Usage): boolean {
  return (
    a.promptTokens === b.promptTokens &&
    a.completionTokens === b.completionTokens &&
    a.totalTokens === b.totalTokens &&
    a.costUsd === b.costUsd &&
    a.calls === b.calls
  );
}

function explainBlackboard(value: unknown): string | null {
  if (!isRecord(value)) return "blackboard";
  if (typeof value.runId !== "string" || !UUID.test(value.runId)) return "blackboard.runId";
  if (typeof value.topic !== "string" || value.topic.length < 1 || value.topic.length > 400) return "blackboard.topic";
  if (value.mode !== "demo" && value.mode !== "live") return "blackboard.mode";
  if (typeof value.model !== "string" || value.model.length > 160) return "blackboard.model";
  if (typeof value.evidence !== "string" || value.evidence.length > 80) return "blackboard.evidence";
  if (!isPhase(value.phase)) return "blackboard.phase";
  if (!isRunStatus(value.status)) return "blackboard.status";
  if (!hasAgentMap(value.agentStatus, isAgentStatus)) return "blackboard.agentStatus";
  if (!hasAgentMap(value.agentDetail, (item) => isString(item, 400))) return "blackboard.agentDetail";
  if (value.plan !== null && !isPlan(value.plan)) return "blackboard.plan";
  if (!isArrayOf(value.sources, 64, isSource)) return "blackboard.sources";
  if (!isArrayOf(value.notes, 24, isNote)) return "blackboard.notes";
  if (!isStringArray(value.gaps, 12, 400)) return "blackboard.gaps";
  if (!isArrayOf(value.critiques, 12, isCritique)) return "blackboard.critiques";
  if (!isInt(value.revision, 0, 20)) return "blackboard.revision";
  if (!isInt(value.maxRevisions, 0, 20)) return "blackboard.maxRevisions";
  if (value.report !== null && !isReport(value.report)) return "blackboard.report";
  if (value.handoff !== null && !isString(value.handoff, 200)) return "blackboard.handoff";
  if (!Array.isArray(value.events) || value.events.length > 800) return "blackboard.events";
  if (value.events.some((event) => !isCrewEvent(event))) return "blackboard.event";
  if (!isUsage(value.usage) || !isBudget(value.budget)) return "blackboard.meter";
  if (value.error !== undefined && !isString(value.error, 500)) return "blackboard.error";
  return null;
}

function isCrewEvent(value: unknown): value is CrewEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "run_started":
      return (
        typeof value.runId === "string" &&
        isString(value.topic, 400) &&
        (value.mode === "demo" || value.mode === "live") &&
        isString(value.model, 160) &&
        isString(value.evidence, 80) &&
        isInt(value.maxRevisions, 0, 20) &&
        isBudget(value.budget)
      );
    case "status":
      return isAgent(value.agent) && isAgentStatus(value.status) && isString(value.detail, 400);
    case "thought":
      return isAgent(value.agent) && isString(value.text, 4000);
    case "plan":
      return value.agent === "planner" && isPlan(value.plan);
    case "notes":
      return value.agent === "researcher" && isArrayOf(value.notes, 24, isNote) && isStringArray(value.gaps, 12, 400);
    case "tool_call":
      return isAgent(value.agent) && isString(value.tool, 80) && isString(value.callId, 80) && isString(value.input, 500);
    case "tool_result":
      return (
        isAgent(value.agent) &&
        isString(value.tool, 80) &&
        isString(value.callId, 80) &&
        isString(value.summary, 2000) &&
        isArrayOf(value.sources, 8, isSource)
      );
    case "handoff":
      return isAgent(value.from) && isAgent(value.to) && isString(value.note, 2000);
    case "revision":
      return isInt(value.revision, 0, 20) && isInt(value.maxRevisions, 0, 20) && isString(value.reason, 2000);
    case "usage":
      return isUsage(value.usage) && isBudget(value.budget);
    case "report":
      return isReport(value.report);
    case "run_finished":
      return value.status !== "pending" && value.status !== "running" && isRunStatus(value.status) && isUsage(value.usage);
    case "error":
      return isString(value.message, 500);
    default:
      return false;
  }
}

function isPlan(value: unknown): value is Plan {
  if (!isRecord(value)) return false;
  return (
    isString(value.audience, 300) &&
    isString(value.thesis, 800) &&
    isStringArray(value.questions, 8, 400) &&
    isStringArray(value.searchQueries, 8, 400) &&
    isStringArray(value.outline, 8, 200) &&
    isString(value.rationale, 800)
  );
}

function isNote(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isString(value.claim, 800) &&
    Array.isArray(value.sourceIds) &&
    value.sourceIds.length >= 1 &&
    value.sourceIds.length <= 8 &&
    value.sourceIds.every((id) => Number.isInteger(id) && (id as number) > 0 && (id as number) < 10_000) &&
    (value.confidence === "low" || value.confidence === "medium" || value.confidence === "high")
  );
}

function isCritique(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.verdict === "approve" || value.verdict === "revise") &&
    isStringArray(value.issues, 8, 500) &&
    isString(value.rationale, 800)
  );
}

function isReport(value: unknown): value is Report {
  if (!isRecord(value)) return false;
  return (
    isString(value.title, 200) &&
    isString(value.summary, 2000) &&
    isArrayOf(value.sections, 8, isSection) &&
    Array.isArray(value.sections) &&
    value.sections.length >= 1 &&
    isArrayOf(value.sources, 64, isSource) &&
    isStringArray(value.reservations, 12, 800)
  );
}

function isSection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isString(value.heading, 200) && isStringArray(value.paragraphs, 6, 2000) && Array.isArray(value.paragraphs) && value.paragraphs.length >= 1;
}

function isSource(value: unknown): value is Source {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.id) &&
    (value.id as number) > 0 &&
    isString(value.title, 300) &&
    isString(value.url, 500) &&
    isString(value.snippet, 1000) &&
    isString(value.locator, 200)
  );
}

function isUsage(value: unknown): value is Usage {
  return usageSchema.safeParse(value).success;
}

function isBudget(value: unknown): value is Budget {
  return budgetSchema.safeParse(value).success;
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value);
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);
}

function isPhase(value: unknown): boolean {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

function isAgent(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENTS as readonly string[]).includes(value);
}

function hasAgentMap(value: unknown, check: (item: unknown) => boolean): boolean {
  if (!isRecord(value)) return false;
  return AGENTS.every((agent) => check(value[agent]));
}

function isArrayOf(value: unknown, max: number, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= max && value.every(check);
}

function isStringArray(value: unknown, maxItems: number, maxLen: number): boolean {
  return isArrayOf(value, maxItems, (item) => isString(item, maxLen));
}

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isInt(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
