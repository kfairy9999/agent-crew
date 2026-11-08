export const AGENTS = ["planner", "researcher", "writer", "critic"] as const;

export type AgentId = (typeof AGENTS)[number];

export type RunMode = "demo" | "live";

export type RunStatus =
  | "pending"
  | "running"
  | "complete"
  | "budget_exceeded"
  | "failed"
  | "stopped";

export type AgentStatus =
  | "idle"
  | "planning"
  | "searching"
  | "reading"
  | "drafting"
  | "revising"
  | "reviewing"
  | "done"
  | "blocked";

export interface Budget {
  maxTokens: number;
  maxCostUsd: number;
}

export interface ModelPrice {
  promptPerMillionUsd: number;
  completionPerMillionUsd: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  calls: number;
}

export interface Source {
  id: number;
  title: string;
  url: string;
  snippet: string;
  locator: string;
}

export interface Plan {
  audience: string;
  thesis: string;
  questions: string[];
  searchQueries: string[];
  outline: string[];
  rationale: string;
}

export interface Note {
  claim: string;
  sourceIds: number[];
  confidence: "low" | "medium" | "high";
}

export interface ReportSection {
  heading: string;
  paragraphs: string[];
}

export interface ReportDraft {
  title: string;
  summary: string;
  sections: ReportSection[];
  rationale: string;
}

export interface Report {
  title: string;
  summary: string;
  sections: ReportSection[];
  sources: Source[];
  reservations: string[];
}

export interface Critique {
  verdict: "approve" | "revise";
  issues: string[];
  rationale: string;
}

export interface ModelContext {
  topic: string;
  revision: number;
  sources: Source[];
  notes: Note[];
  gaps: string[];
  draft: ReportDraft | null;
  critique: Critique | null;
  mechanicalIssues: string[];
}

export type CrewEvent =
  | {
      type: "run_started";
      runId: string;
      topic: string;
      mode: RunMode;
      model: string;
      evidence: string;
      maxRevisions: number;
      budget: Budget;
    }
  | { type: "status"; agent: AgentId; status: AgentStatus; detail: string }
  | { type: "thought"; agent: AgentId; text: string }
  | { type: "plan"; agent: "planner"; plan: Plan }
  | { type: "notes"; agent: "researcher"; notes: Note[]; gaps: string[] }
  | {
      type: "tool_call";
      agent: AgentId;
      tool: string;
      callId: string;
      input: string;
    }
  | {
      type: "tool_result";
      agent: AgentId;
      tool: string;
      callId: string;
      summary: string;
      sources: Source[];
    }
  | { type: "handoff"; from: AgentId; to: AgentId; note: string }
  | { type: "revision"; revision: number; maxRevisions: number; reason: string }
  | { type: "usage"; usage: Usage; budget: Budget }
  | { type: "report"; report: Report }
  | {
      type: "run_finished";
      status: Exclude<RunStatus, "pending" | "running">;
      usage: Usage;
    }
  | { type: "error"; message: string };

export interface Blackboard {
  runId: string;
  topic: string;
  mode: RunMode;
  model: string;
  evidence: string;
  phase: "idle" | "planning" | "researching" | "writing" | "critiquing" | "revising" | "done";
  agentStatus: Record<AgentId, AgentStatus>;
  agentDetail: Record<AgentId, string>;
  plan: Plan | null;
  sources: Source[];
  notes: Note[];
  gaps: string[];
  critiques: Critique[];
  revision: number;
  maxRevisions: number;
  report: Report | null;
  handoff: string | null;
  events: CrewEvent[];
  usage: Usage;
  budget: Budget;
  status: RunStatus;
  error?: string;
}

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmRequest {
  agent: AgentId;
  messages: LlmMessage[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LlmResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResult>;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  locator: string;
}

export interface SearchTool {
  readonly name: string;
  search(query: string, limit: number, signal?: AbortSignal): Promise<SearchHit[]>;
}
