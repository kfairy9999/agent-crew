import { useEffect, useState } from "react";
import { AGENTS, type RunMode } from "../core";
import { PRESETS } from "../demo/presets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Lane } from "./components/lane";
import { ReportView } from "./components/report-view";
import { useCrew } from "./lib/use-crew";

interface PublicConfig {
  liveAvailable: boolean;
  model: string;
  maxRevisions: number;
  budget: { maxTokens: number; maxCostUsd: number };
  rateLimit: { liveRunsPerWindow: number; windowSeconds: number };
}

export function App() {
  const { state, running, error, run, stop } = useCrew();
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<RunMode>("demo");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Config failed");
        return (await response.json()) as PublicConfig;
      })
      .then((payload) => {
        setConfig(payload);
        setConfigError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setConfigError(caught instanceof Error ? caught.message : "Config failed");
      });
    return () => controller.abort();
  }, []);

  const liveAvailable = config?.liveAvailable ?? false;
  const budget = state.budget.maxTokens > 0 ? state.budget : config?.budget ?? { maxTokens: 8000, maxCostUsd: 0.05 };
  const tokenPct = Math.min(100, (state.usage.totalTokens / budget.maxTokens) * 100);
  const costPct = budget.maxCostUsd > 0 ? Math.min(100, (state.usage.costUsd / budget.maxCostUsd) * 100) : 0;
  const meter = Math.max(tokenPct, costPct);
  const handoff = [...state.events].reverse().find((event) => event.type === "handoff");
  const topicTooShort = topic.trim().length > 0 && topic.trim().length < 8;

  function submit() {
    const trimmed = topic.trim();
    if (trimmed.length < 8 || running) return;
    void run(trimmed, mode);
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line/80">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-4 px-4 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex gap-1" aria-hidden>
                <i className="h-3 w-3 bg-planner" />
                <i className="h-3 w-3 bg-researcher" />
                <i className="h-3 w-3 bg-paper" />
                <i className="h-3 w-3 bg-critic" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Kevin Fairley</p>
            </div>
            <h1 className="mt-1 font-serif text-4xl leading-none text-paper">Agent Crew</h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              Four specialists. One short brief. The trace stays on the desk until the critic signs off.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Badge data-testid="mode-badge" className={mode === "live" ? "border-critic text-critic" : "border-planner text-planner"}>
              <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-good" : "bg-current"}`} />
              {mode === "live" ? "Live" : "Demo"}
              {running ? " · running" : ""}
            </Badge>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>
                {state.usage.totalTokens.toLocaleString()} / {budget.maxTokens.toLocaleString()} tokens
              </span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line" aria-hidden>
                <span className="block h-full bg-planner" style={{ width: `${meter}%` }} />
              </span>
              <span>{formatCost(state.usage.costUsd)}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-4 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-md border border-line bg-ink-2/70 p-4 lg:sticky lg:top-4 lg:self-start">
          <label htmlFor="assignment" className="text-[11px] uppercase tracking-[0.16em] text-muted">
            Assignment
          </label>
          <Textarea
            id="assignment"
            value={topic}
            maxLength={400}
            placeholder="Assign a question. The crew will plan, search, draft, and argue."
            onChange={(event) => setTopic(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
            }}
            disabled={running}
            className="mt-2"
          />
          <p className="mt-1 text-right text-[11px] text-muted">{topic.trim().length}/400</p>
          <div className="mt-3 flex flex-col gap-2">
            {PRESETS.map((preset) => {
              const selected = topic === preset.topic;
              return (
                <Button
                  key={preset.id}
                  type="button"
                  variant={selected ? "default" : "secondary"}
                  className="h-auto items-start justify-start whitespace-normal px-3 py-2 text-left"
                  disabled={running}
                  onClick={() => setTopic(preset.topic)}
                >
                  <span>
                    <span className="block text-sm">{preset.label}</span>
                    <span className={`block text-xs font-normal ${selected ? "text-ink/70" : "text-muted"}`}>
                      {preset.blurb}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
          <div className="mt-4 flex gap-2" role="group" aria-label="Run mode">
            <Button type="button" size="sm" variant={mode === "demo" ? "default" : "secondary"} onClick={() => setMode("demo")}>
              Demo
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "live" ? "danger" : "secondary"}
              disabled={!liveAvailable}
              title={liveAvailable ? "Calls Groq with the Worker secret. Rate limited." : "No GROQ_API_KEY on this desk."}
              onClick={() => setMode("live")}
            >
              Live
            </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {mode === "demo"
              ? "Demo replays the real orchestrator against a scripted model and a local corpus. It does not call Groq."
              : `Live calls ${config?.model ?? "the configured model"} on Groq. ${config?.rateLimit.liveRunsPerWindow ?? 2} runs per ${Math.round((config?.rateLimit.windowSeconds ?? 600) / 60)} minutes on this isolate, critic cap ${config?.maxRevisions ?? 2}.`}
          </p>
          {topicTooShort ? <p className="mt-2 text-xs text-critic">Give the crew at least a short assignment.</p> : null}
          <div className="mt-4 flex gap-2">
            {running ? (
              <Button type="button" variant="danger" onClick={stop}>
                Stop the crew
              </Button>
            ) : (
              <Button type="button" onClick={submit} disabled={topic.trim().length < 8}>
                Run the crew
              </Button>
            )}
          </div>
          {configError ? <p className="mt-3 text-xs text-critic">Could not read desk config. Demo still runs.</p> : null}
        </section>

        <section>
          {error ? (
            <p role="alert" className="mb-3 rounded-md border border-critic/60 bg-critic/10 px-3 py-2 text-sm text-critic">
              {error}
            </p>
          ) : null}
          {state.error ? (
            <p role="alert" className="mb-3 rounded-md border border-planner/50 bg-planner/10 px-3 py-2 text-sm text-planner">
              {state.error}
            </p>
          ) : null}
          <p data-testid="handoff" className="mb-3 min-h-6 text-sm leading-relaxed text-muted">
            {handoff && handoff.type === "handoff"
              ? `${handoff.from} → ${handoff.to} · ${handoff.note}`
              : running
                ? "Opening the desk…"
                : "No handoff yet. The crew waits for an assignment."}
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {AGENTS.map((agent) => (
              <Lane
                key={agent}
                agent={agent}
                status={state.agentStatus[agent]}
                detail={state.agentDetail[agent]}
                events={state.events}
              />
            ))}
          </div>
          <ReportView report={state.report} mode={state.mode} model={state.model} evidence={state.evidence} />
        </section>
      </main>
      <footer className="mx-auto max-w-[1440px] px-4 pb-8 text-xs text-muted">
        MIT licensed. The orchestration core — messages, blackboard, critic cap, token budget — is tested without a
        network.
      </footer>
    </div>
  );
}

function formatCost(cost: number): string {
  if (cost <= 0) return "$0.0000";
  if (cost < 0.0001) return "< $0.0001";
  return `$${cost.toFixed(4)}`;
}
