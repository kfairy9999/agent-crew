import { DEFAULT_BUDGET, DEFAULT_PRICE } from "../core/budget";
import type { Budget, ModelPrice } from "../core/types";
import { DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL } from "../llm/constants";

export interface WorkerBindings {
  GROQ_API_KEY?: string;
  GROQ_BASE_URL?: string;
  GROQ_MODEL?: string;
  LIVE_RATE_CAPACITY?: string;
  LIVE_RATE_WINDOW_MS?: string;
  LIVE_GLOBAL_CAPACITY?: string;
  MAX_REVISIONS?: string;
  BUDGET_MAX_TOKENS?: string;
  BUDGET_MAX_COST_USD?: string;
  PRICE_PROMPT_PER_MILLION?: string;
  PRICE_COMPLETION_PER_MILLION?: string;
  /** Optional. Unset keeps runs in the browser. Never log this value. */
  MONGODB_URI?: string;
  /** Optional database name. Defaults to `agent_crew`. */
  MONGODB_DB_NAME?: string;
}

export const BINDING_KEYS = [
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "GROQ_MODEL",
  "LIVE_RATE_CAPACITY",
  "LIVE_RATE_WINDOW_MS",
  "LIVE_GLOBAL_CAPACITY",
  "MAX_REVISIONS",
  "BUDGET_MAX_TOKENS",
  "BUDGET_MAX_COST_USD",
  "PRICE_PROMPT_PER_MILLION",
  "PRICE_COMPLETION_PER_MILLION",
  "MONGODB_URI",
  "MONGODB_DB_NAME",
] as const satisfies readonly (keyof WorkerBindings)[];

export interface Settings {
  groqApiKey?: string;
  liveAvailable: boolean;
  baseUrl: string;
  model: string;
  budget: Budget;
  maxRevisions: number;
  price: ModelPrice;
  liveCapacity: number;
  liveWindowMs: number;
  globalCapacity: number;
}

export function readSettings(env: WorkerBindings | undefined): Settings {
  const key = env?.GROQ_API_KEY?.trim();
  return {
    groqApiKey: key || undefined,
    liveAvailable: Boolean(key),
    baseUrl: env?.GROQ_BASE_URL?.trim() || DEFAULT_GROQ_BASE_URL,
    model: env?.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    budget: {
      maxTokens: positiveInt(env?.BUDGET_MAX_TOKENS, DEFAULT_BUDGET.maxTokens),
      maxCostUsd: positiveNum(env?.BUDGET_MAX_COST_USD, DEFAULT_BUDGET.maxCostUsd),
    },
    maxRevisions: Math.min(4, positiveInt(env?.MAX_REVISIONS, 2)),
    price: {
      promptPerMillionUsd: positiveNum(env?.PRICE_PROMPT_PER_MILLION, DEFAULT_PRICE.promptPerMillionUsd),
      completionPerMillionUsd: positiveNum(
        env?.PRICE_COMPLETION_PER_MILLION,
        DEFAULT_PRICE.completionPerMillionUsd,
      ),
    },
    liveCapacity: positiveInt(env?.LIVE_RATE_CAPACITY, 2),
    liveWindowMs: positiveInt(env?.LIVE_RATE_WINDOW_MS, 600_000),
    globalCapacity: positiveInt(env?.LIVE_GLOBAL_CAPACITY, 4),
  };
}

export function isBindingKey(key: string): key is keyof WorkerBindings {
  return (BINDING_KEYS as readonly string[]).includes(key);
}

const DB_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function mongoConfigured(env: WorkerBindings | undefined): boolean {
  return Boolean(env?.MONGODB_URI?.trim());
}

export function mongoDbName(env: WorkerBindings | undefined): string {
  const name = env?.MONGODB_DB_NAME?.trim() ?? "";
  return DB_NAME.test(name) ? name : "agent_crew";
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function positiveNum(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
