import type { Budget, ModelPrice, Usage } from "./types";

/** Planning rates for the meter. Groq list prices move; override them with Worker vars. */
export const DEFAULT_PRICE: ModelPrice = {
  promptPerMillionUsd: 0.29,
  completionPerMillionUsd: 0.59,
};

export const DEFAULT_BUDGET: Budget = {
  maxTokens: 8000,
  maxCostUsd: 0.05,
};

/** Conservative guess used to refuse a call before it is sent. */
export const DEFAULT_CALL_ESTIMATE = {
  promptTokens: 350,
  completionTokens: 450,
};

export function emptyUsage(): Usage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    calls: 0,
  };
}

export function costUsd(
  promptTokens: number,
  completionTokens: number,
  price: ModelPrice,
): number {
  const raw =
    (promptTokens * price.promptPerMillionUsd +
      completionTokens * price.completionPerMillionUsd) /
    1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

export function addUsage(
  usage: Usage,
  delta: { promptTokens: number; completionTokens: number },
  price: ModelPrice,
): Usage {
  const promptTokens = usage.promptTokens + Math.max(0, Math.round(delta.promptTokens));
  const completionTokens =
    usage.completionTokens + Math.max(0, Math.round(delta.completionTokens));
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: costUsd(promptTokens, completionTokens, price),
    calls: usage.calls + 1,
  };
}

export function wouldExceed(
  usage: Usage,
  budget: Budget,
  price: ModelPrice,
  estimate: { promptTokens: number; completionTokens: number },
): boolean {
  const next = addUsage(usage, estimate, price);
  return next.totalTokens > budget.maxTokens || next.costUsd > budget.maxCostUsd + 1e-12;
}

export function overBudget(usage: Usage, budget: Budget): boolean {
  return usage.totalTokens > budget.maxTokens || usage.costUsd > budget.maxCostUsd + 1e-12;
}
