export interface Preset {
  id: string;
  label: string;
  topic: string;
  blurb: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "blackboard",
    label: "Shared blackboard",
    topic: "How does a shared blackboard keep a multi-agent crew consistent?",
    blurb: "Reducer, handoffs, and why concurrent writes still break.",
  },
  {
    id: "hiring",
    label: "Hiring signals",
    topic: "What should a hiring manager look for in an agentic AI engineer?",
    blurb: "Traces, limits, and a demo that does not spend a key.",
  },
  {
    id: "critic",
    label: "Critic or search",
    topic: "When does a critic loop beat another round of search?",
    blurb: "Revise misuse. Search when the evidence is missing.",
  },
] as const;

export function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchPreset(topic: string): Preset | undefined {
  const normalized = normalizeTopic(topic);
  return PRESETS.find((preset) => normalizeTopic(preset.topic) === normalized);
}
