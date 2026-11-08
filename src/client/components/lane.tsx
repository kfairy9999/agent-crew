import { Compass, PenLine, Search, ShieldCheck, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AgentId, AgentStatus, CrewEvent } from "../../core";

const META: Record<AgentId, { label: string; role: string; dot: string; icon: LucideIcon }> = {
  planner: { label: "Planner", role: "Cuts the question", dot: "bg-planner", icon: Compass },
  researcher: { label: "Researcher", role: "Retrieves sources", dot: "bg-researcher", icon: Search },
  writer: { label: "Writer", role: "Drafts the brief", dot: "bg-paper", icon: PenLine },
  critic: { label: "Critic", role: "Rejects weak claims", dot: "bg-critic", icon: ShieldCheck },
};

export function Lane({
  agent,
  status,
  detail,
  events,
}: {
  agent: AgentId;
  status: AgentStatus;
  detail: string;
  events: CrewEvent[];
}) {
  const meta = META[agent];
  const Icon = meta.icon;
  const scroller = useRef<HTMLDivElement>(null);
  const cards = eventsFor(agent, events);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [cards.length]);

  return (
    <article
      data-testid={`lane-${agent}`}
      className="flex min-h-[280px] flex-col overflow-hidden rounded-md border border-line bg-panel/90"
    >
      <header className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <Icon className="h-3.5 w-3.5 opacity-70" aria-hidden />
              {meta.label}
            </h2>
            <p className="text-[11px] text-muted">{meta.role}</p>
          </div>
        </div>
        <p className="text-right text-[10px] uppercase tracking-[0.14em] text-muted">{labelStatus(status)}</p>
      </header>
      <div ref={scroller} className="lane-scroll flex max-h-[340px] flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        {cards.length === 0 ? (
          <p className="text-sm text-muted">{detail}</p>
        ) : (
          cards.map((event, index) => <EventCard key={index} index={index} event={event} agent={agent} />)
        )}
      </div>
    </article>
  );
}

function labelStatus(status: AgentStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "planning":
      return "Planning";
    case "searching":
      return "Searching";
    case "reading":
      return "Reading";
    case "drafting":
      return "Drafting";
    case "revising":
      return "Revising";
    case "reviewing":
      return "Reviewing";
    case "done":
      return "Done";
    case "blocked":
      return "Blocked";
    default:
      return status;
  }
}

function eventsFor(agent: AgentId, events: CrewEvent[]): CrewEvent[] {
  return events.filter((event) => {
    switch (event.type) {
      case "thought":
      case "status":
      case "tool_call":
      case "tool_result":
      case "plan":
      case "notes":
        return event.agent === agent;
      case "handoff":
        return event.from === agent || event.to === agent;
      case "revision":
        return agent === "writer" || agent === "critic";
      default:
        return false;
    }
  });
}

function EventCard({ event, index, agent }: { event: CrewEvent; index: number; agent: AgentId }) {
  return (
    <div className="rounded-sm border border-line/80 bg-ink/50 px-2.5 py-2">
      <div className="mb-1 font-mono text-[10px] tracking-wider text-muted">{String(index + 1).padStart(2, "0")}</div>
      <EventBody event={event} agent={agent} />
    </div>
  );
}

function EventBody({ event, agent }: { event: CrewEvent; agent: AgentId }) {
  switch (event.type) {
    case "thought":
      return <p className="font-serif text-[15px] leading-snug text-paper">{event.text}</p>;
    case "status":
      return <p className="text-xs text-muted">{event.detail}</p>;
    case "plan":
      return (
        <div className="space-y-1 text-sm">
          <p>{event.plan.thesis}</p>
          <p className="text-xs text-muted">{event.plan.searchQueries.join(" · ")}</p>
        </div>
      );
    case "notes":
      return (
        <ul className="space-y-1 text-sm">
          {event.notes.map((note) => (
            <li key={note.claim}>
              {note.claim}{" "}
              <span className="text-xs text-researcher">{note.sourceIds.map((id) => `[${id}]`).join(" ")}</span>
            </li>
          ))}
          {event.gaps.map((gap) => (
            <li key={gap} className="text-xs text-muted">
              Gap: {gap}
            </li>
          ))}
        </ul>
      );
    case "tool_call":
      return (
        <p className="font-mono text-xs leading-relaxed text-researcher">
          {event.tool}
          <br />
          {event.input}
        </p>
      );
    case "tool_result":
      return <p className="text-xs leading-relaxed text-paper">{event.summary}</p>;
    case "handoff":
      return (
        <p className="border-l-2 border-planner pl-2 text-xs leading-relaxed">
          {event.from === agent ? `Handed to ${event.to}` : `From ${event.from}`}
          <span className="mt-1 block text-muted">{event.note}</span>
        </p>
      );
    case "revision":
      return (
        <p className="text-sm leading-snug text-critic">
          Revision {event.revision}/{event.maxRevisions}. {event.reason}
        </p>
      );
    default:
      return null;
  }
}
