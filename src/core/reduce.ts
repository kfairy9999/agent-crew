import { emptyUsage } from "./budget";
import { AGENTS, type AgentId, type AgentStatus, type Blackboard, type CrewEvent } from "./types";

const IDLE_STATUS = Object.fromEntries(AGENTS.map((agent) => [agent, "idle"])) as Record<
  AgentId,
  AgentStatus
>;

const IDLE_DETAIL = Object.fromEntries(AGENTS.map((agent) => [agent, "Standing by"])) as Record<
  AgentId,
  string
>;

export function createBlackboard(input?: {
  topic?: string;
  mode?: Blackboard["mode"];
  budget?: Blackboard["budget"];
  maxRevisions?: number;
}): Blackboard {
  return {
    runId: "",
    topic: input?.topic ?? "",
    mode: input?.mode ?? "demo",
    model: "",
    evidence: "",
    phase: "idle",
    agentStatus: { ...IDLE_STATUS },
    agentDetail: { ...IDLE_DETAIL },
    plan: null,
    sources: [],
    notes: [],
    gaps: [],
    critiques: [],
    revision: 0,
    maxRevisions: input?.maxRevisions ?? 2,
    report: null,
    handoff: null,
    events: [],
    usage: emptyUsage(),
    budget: input?.budget ?? { maxTokens: 8000, maxCostUsd: 0.05 },
    status: "pending",
  };
}

function phaseFor(status: AgentStatus, agent: AgentId, revision: number): Blackboard["phase"] {
  if (agent === "planner") return "planning";
  if (agent === "researcher") return "researching";
  if (agent === "critic") return "critiquing";
  if (status === "revising" || revision > 0) return "revising";
  return "writing";
}

export function reduce(state: Blackboard, event: CrewEvent): Blackboard {
  const next: Blackboard = {
    ...state,
    agentStatus: { ...state.agentStatus },
    agentDetail: { ...state.agentDetail },
    sources: state.sources,
    notes: state.notes,
    gaps: state.gaps,
    critiques: state.critiques,
    events: [...state.events, event],
  };

  switch (event.type) {
    case "run_started":
      next.runId = event.runId;
      next.topic = event.topic;
      next.mode = event.mode;
      next.model = event.model;
      next.evidence = event.evidence;
      next.maxRevisions = event.maxRevisions;
      next.budget = event.budget;
      next.status = "running";
      next.phase = "planning";
      next.error = undefined;
      break;
    case "status":
      next.agentStatus[event.agent] = event.status;
      next.agentDetail[event.agent] = event.detail;
      next.phase = phaseFor(event.status, event.agent, next.revision);
      break;
    case "plan":
      next.plan = event.plan;
      break;
    case "notes":
      next.notes = event.notes;
      next.gaps = event.gaps;
      break;
    case "tool_result":
      if (event.sources.length > 0) {
        const seen = new Set(next.sources.map((source) => source.locator));
        const added = event.sources.filter((source) => !seen.has(source.locator));
        next.sources = [...next.sources, ...added];
      }
      break;
    case "handoff":
      next.handoff = `${event.from} → ${event.to}`;
      next.agentDetail[event.to] = event.note;
      break;
    case "revision":
      next.revision = event.revision;
      next.maxRevisions = event.maxRevisions;
      next.phase = "revising";
      break;
    case "usage":
      next.usage = event.usage;
      next.budget = event.budget;
      break;
    case "report":
      next.report = event.report;
      break;
    case "error":
      next.error = event.message;
      break;
    case "run_finished":
      next.status = event.status;
      next.usage = event.usage;
      next.phase = "done";
      next.handoff = null;
      for (const agent of AGENTS) {
        if (next.agentStatus[agent] === "idle") continue;
        next.agentStatus[agent] = event.status === "complete" ? "done" : "blocked";
      }
      break;
    case "thought":
    case "tool_call":
      break;
  }

  return next;
}

export function fold(events: CrewEvent[], initial?: Blackboard): Blackboard {
  return events.reduce(reduce, initial ?? createBlackboard());
}
