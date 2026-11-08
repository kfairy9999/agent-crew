import type { CrewEvent, RunMode } from "../core/types";
import { orchestrate } from "../core/orchestrator";
import { ScriptedModel } from "../demo/scripted-model";
import { OpenAICompatibleClient } from "../llm/openai-compatible";
import { FixtureSearch } from "../tools/fixture-search";
import { WikipediaSearch } from "../tools/wikipedia";
import type { Settings } from "./bindings";

export function startCrew(input: {
  topic: string;
  mode: RunMode;
  settings: Settings;
  runId: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): AsyncGenerator<CrewEvent> {
  const live = input.mode === "live";
  return orchestrate(input.topic, {
    llm: live
      ? new OpenAICompatibleClient({
          apiKey: input.settings.groqApiKey ?? "",
          baseUrl: input.settings.baseUrl,
          model: input.settings.model,
          fetchImpl: input.fetchImpl,
        })
      : new ScriptedModel(),
    search: live ? new WikipediaSearch(input.fetchImpl) : new FixtureSearch(),
    budget: input.settings.budget,
    price: input.settings.price,
    maxRevisions: input.settings.maxRevisions,
    mode: input.mode,
    runId: input.runId,
    model: live ? input.settings.model : "demo-scripted",
    signal: input.signal,
  });
}
