import type { LlmClient, LlmMessage, LlmRequest, LlmResult, ModelContext, Source } from "../core/types";
import { readModelJson } from "../core/json";
import { z } from "zod";
import { matchPreset, type Preset } from "./presets";

const contextSchema = z.object({
  topic: z.string(),
  revision: z.number(),
  sources: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
      locator: z.string(),
    }),
  ),
  notes: z.array(
    z.object({
      claim: z.string(),
      sourceIds: z.array(z.number()),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
  gaps: z.array(z.string()),
  draft: z.unknown().nullable(),
  critique: z.unknown().nullable(),
  mechanicalIssues: z.array(z.string()),
});

const STOP = new Set([
  "how",
  "does",
  "the",
  "a",
  "an",
  "of",
  "to",
  "and",
  "in",
  "for",
  "what",
  "when",
  "should",
  "with",
  "keep",
  "from",
  "that",
  "this",
  "into",
  "about",
]);

/**
 * Recorded stand-in for the live model. Same request shape, deterministic JSON,
 * and a deliberate bad first draft so the critic loop is visible.
 */
export class ScriptedModel implements LlmClient {
  async complete(request: LlmRequest): Promise<LlmResult> {
    const context = readContext(request.messages);
    const preset = matchPreset(context.topic);
    const value = preset
      ? presetResponse(preset, request.agent, context)
      : genericResponse(request.agent, context);
    return pack(value, request.messages);
  }
}

function readContext(messages: LlmMessage[]): ModelContext {
  const user = [...messages].reverse().find((message) => message.role === "user");
  const match = user?.content.match(/<context>\n([\s\S]*?)\n<\/context>/);
  const raw = match?.[1];
  if (!raw) throw new Error("Scripted model did not find a context block.");
  const parsed = readModelJson(contextSchema, raw);
  return {
    topic: parsed.topic,
    revision: parsed.revision,
    sources: parsed.sources,
    notes: parsed.notes,
    gaps: parsed.gaps,
    draft: null,
    critique: null,
    mechanicalIssues: parsed.mechanicalIssues,
  };
}

function pack(value: unknown, messages: LlmMessage[]): LlmResult {
  const content = JSON.stringify(value);
  const promptTokens =
    220 + Math.floor(messages.reduce((sum, message) => sum + message.content.length, 0) / 16);
  const completionTokens = Math.max(40, Math.floor(content.length / 4));
  return { content, promptTokens, completionTokens, model: "demo-scripted" };
}

function presetResponse(preset: Preset, agent: LlmRequest["agent"], ctx: ModelContext): unknown {
  switch (agent) {
    case "planner":
      return plans[preset.id] ?? genericPlan(ctx);
    case "researcher":
      return research(ctx);
    case "writer": {
      const open = openings[preset.id];
      return ctx.revision === 0 ? badDraft(ctx, open ? open(ctx) : genericOpening(ctx)) : goodDraft(preset.id, ctx);
    }
    case "critic":
      return ctx.revision === 0 ? reviseCritique(preset.id) : approveCritique();
    default:
      return genericPlan(ctx);
  }
}

function genericResponse(agent: LlmRequest["agent"], ctx: ModelContext): unknown {
  switch (agent) {
    case "planner":
      return genericPlan(ctx);
    case "researcher":
      return research(ctx);
    case "writer":
      return ctx.revision === 0 ? badDraft(ctx, genericOpening(ctx)) : genericGoodDraft(ctx);
    case "critic":
      return ctx.revision === 0 ? genericRevise() : approveCritique();
    default:
      return genericPlan(ctx);
  }
}

const plans: Record<string, unknown> = {
  blackboard: {
    audience: "an engineer reading the trace",
    thesis: "A shared blackboard keeps a crew consistent only when one reducer serializes the writes.",
    questions: [
      "What does the next agent actually read?",
      "Why are concurrent writers unsafe?",
      "What should the critic refuse?",
    ],
    searchQueries: [
      "shared blackboard serialized reducer handoff snapshot",
      "streaming trace sse lanes handoff operator",
      "citation retrieved source grounding marker",
    ],
    outline: ["One snapshot", "What the critic is for", "Cost of another pass"],
    rationale: "The failure mode is concurrent writes, not a missing chat log. I will search for that.",
  },
  hiring: {
    audience: "a hiring manager",
    thesis: "Agentic engineering shows up as a testable boundary, a visible trace, and a demo that does not spend a key.",
    questions: [
      "What can a stranger test without a tour?",
      "Where should the trace be more honest than the final paragraph?",
    ],
    searchQueries: [
      "hiring manager portfolio trace engineer",
      "streaming trace sse lanes operator",
      "eval fixture test score budget tokens",
    ],
    outline: ["Trace over transcript", "Limits are features"],
    rationale: "I am planning for signals a reviewer can check, not a list of agent names.",
  },
  critic: {
    audience: "someone deciding whether to revise or search",
    thesis: "A critic loop fixes misuse of evidence already on the table. It does not create missing evidence.",
    questions: ["Which defects are local?", "When is another search the honest move?"],
    searchQueries: [
      "search critique evidence query revise",
      "critic revision cap loop reservation",
      "citation retrieved source grounding marker",
    ],
    outline: ["Two different failures", "When to stop"],
    rationale: "I want the brief to separate a bad citation from a missing source.",
  },
};

const openings: Record<string, (ctx: ModelContext) => { title: string; summary: string; sections: { heading: string; paragraphs: string[] }[] }> = {
  blackboard: () => ({
    title: "The blackboard guarantees concurrent consistency",
    summary: "A shared blackboard guarantees consistency even when every agent writes at once [99].",
    sections: [
      {
        heading: "Concurrent writers",
        paragraphs: ["Once the board exists, order no longer matters, so the crew can skip handoffs [99]."],
      },
    ],
  }),
  hiring: () => ({
    title: "Ship a polished chat",
    summary: "A polished chat demo is the main signal hiring managers trust [99].",
    sections: [
      {
        heading: "What they click",
        paragraphs: ["Reviewers score the final paragraph and ignore whether a claim can be opened [99]."],
      },
    ],
  }),
  critic: () => ({
    title: "Always revise in place",
    summary: "If the critic is unhappy, the writer should always revise in place instead of searching again [99].",
    sections: [
      {
        heading: "Another pass",
        paragraphs: ["Missing evidence is a wording problem, so another adjective will close the gap [99]."],
      },
    ],
  }),
};

function badDraft(ctx: ModelContext, opening: { title: string; summary: string; sections: { heading: string; paragraphs: string[] }[] }): unknown {
  return { ...opening, rationale: "First draft overclaims. The critic should reject the citation that is not on the board." };
}

function goodDraft(id: string, ctx: ModelContext): unknown {
  if (id === "blackboard") return blackboardBrief(ctx);
  if (id === "hiring") return hiringBrief(ctx);
  return criticBrief(ctx);
}

function blackboardBrief(ctx: ModelContext): unknown {
  const board = marker(ctx.sources, "fixture:blackboard");
  const trace = marker(ctx.sources, "fixture:traces");
  const loop = marker(ctx.sources, "fixture:critic-loop");
  const cite = marker(ctx.sources, "fixture:citations");
  const budget = marker(ctx.sources, "fixture:budgets");
  return {
    title: "Consistency is a reducer, not a shared chat",
    summary: `A crew stays consistent when every specialist writes through one reducer and the next role reads that snapshot. A blackboard does not make concurrent writers safe.${board}`,
    sections: [
      {
        heading: "One snapshot",
        paragraphs: [
          `The next agent does not inherit a private chat. It reads the plan, the sources, the notes, and the critique. A handoff names what that role may change.${board}${trace}`,
        ],
      },
      {
        heading: "What the critic is for",
        paragraphs: [
          `A local defect, such as a citation that is not on the board, is a revision. A missing fact is a search. Unknown markers should fail a check that is not another model.${loop}${cite}`,
        ],
      },
      {
        heading: "Cost of another pass",
        paragraphs: [
          `The run records tokens and a price estimate, and it stops when a ceiling would break. Publishing a reserved draft is a better failure than a silent extra call.${budget}`,
        ],
      },
    ],
    rationale: "Dropped the concurrent-write guarantee and cited only sources that were retrieved.",
  };
}

function hiringBrief(ctx: ModelContext): unknown {
  const hiring = marker(ctx.sources, "fixture:hiring");
  const trace = marker(ctx.sources, "fixture:traces");
  const budget = marker(ctx.sources, "fixture:budgets");
  const evalDoc = marker(ctx.sources, "fixture:eval");
  return {
    title: "Show the boundary a stranger can test",
    summary: `A hiring manager is checking for a system they can run, not a diagram of roles. The signals are a typed trace, a limit that stops the loop, citations that open, and a demo that does not spend their key.${hiring}`,
    sections: [
      {
        heading: "Trace over transcript",
        paragraphs: [
          `Lanes for status, rationale, tool calls, and handoffs show who decided what. A final paragraph with no trace hides the failure that taught the writer to revise.${trace}${hiring}`,
        ],
      },
      {
        heading: "Limits are features",
        paragraphs: [
          `A critic cap and a token budget belong in the test suite, next to a scripted model that replays the handoffs without a network. Live calls stay behind a secret and a rate limit.${budget}${evalDoc}`,
        ],
      },
    ],
    rationale: "Replaced the chat-demo claim with signals a reviewer can actually inspect.",
  };
}

function criticBrief(ctx: ModelContext): unknown {
  const versus = marker(ctx.sources, "fixture:search-vs-critique");
  const loop = marker(ctx.sources, "fixture:critic-loop");
  const cite = marker(ctx.sources, "fixture:citations");
  return {
    title: "Revise misuse, search absence",
    summary: `A critic loop fixes a draft that mishandles evidence already on the table. It does not create evidence. When the source is missing, another adjective is how a crew becomes confidently wrong.${versus}`,
    sections: [
      {
        heading: "Two different failures",
        paragraphs: [
          `Unknown citations and overclaims are writer errors. The fix is a revision, and a non-model check should reject ids that were never retrieved.${cite}${loop}`,
        ],
      },
      {
        heading: "When to stop",
        paragraphs: [
          `Two revisions can repair structure. After that, attach the unresolved issue and publish. Searching again is the right move only when the notes have a gap the draft cannot honestly fill.${loop}${versus}`,
        ],
      },
    ],
    rationale: "Separated a bad citation, which the writer can fix, from missing evidence, which needs search.",
  };
}

function reviseCritique(id: string): unknown {
  const issues: Record<string, string> = {
    blackboard: "The draft claims concurrent writes are safe. The source says they are the failure mode.",
    hiring: "A polished chat is not the signal the hiring note describes.",
    critic: "The draft tells the writer to revise when the evidence is missing.",
  };
  return {
    verdict: "revise",
    issues: [issues[id] ?? "The draft cites a source that was not retrieved."],
    rationale: "Rejecting the first draft. It uses a citation id that is not on the blackboard.",
  };
}

function approveCritique(): unknown {
  return {
    verdict: "approve",
    issues: [],
    rationale: "Citations resolve, and the claims now match the retrieved notes.",
  };
}

function genericRevise(): unknown {
  return {
    verdict: "revise",
    issues: ["The draft treats a gap as a finding and cites an id that was not retrieved."],
    rationale: "The corpus was not asked a question it can settle. Ask the writer to say so.",
  };
}

function research(ctx: ModelContext): unknown {
  const notes = ctx.sources.slice(0, 4).map((source) => ({
    claim: firstSentence(source.snippet) || source.title,
    sourceIds: [source.id],
    confidence: "high" as const,
  }));
  const gaps = hasDirectCoverage(ctx.topic, ctx.sources)
    ? ["The notes are short extracts, not a full literature review."]
    : ["The retrieved sources do not study this topic directly."];
  return {
    rationale:
      notes.length > 0
        ? `Keeping ${notes.length} claim${notes.length === 1 ? "" : "s"} that quote the retrieved text.`
        : "Nothing came back from search, so I will not invent a note.",
    notes,
    gaps,
  };
}

function genericPlan(ctx: ModelContext): unknown {
  const words = ctx.topic.split(/\s+/).slice(0, 8).join(" ");
  return {
    audience: "a careful reader",
    thesis: `The demo corpus may only partially cover this assignment: ${ctx.topic}`.slice(0, 400),
    questions: [`What does the fixture corpus actually say that touches “${clip(ctx.topic, 80)}”?`],
    searchQueries: [clip(words, 140), "citation retrieved source grounding marker"],
    outline: ["What was retrieved", "What it does not settle"],
    rationale: "I will only promise what a local corpus can support.",
  };
}

function genericOpening(ctx: ModelContext): { title: string; summary: string; sections: { heading: string; paragraphs: string[] }[] } {
  return {
    title: clip(`Settled: ${ctx.topic}`, 140),
    summary: "The corpus confirms the topic is settled practice [99].",
    sections: [
      {
        heading: "Finding",
        paragraphs: ["No further search is required because the answer is already standard [99]."],
      },
    ],
  };
}

function genericGoodDraft(ctx: ModelContext): unknown {
  if (ctx.sources.length === 0) {
    return {
      title: "No source was retrieved",
      summary: "No source was retrieved for this assignment, so this brief does not state a finding.",
      sections: [
        {
          heading: "Gap",
          paragraphs: ["Without a retrieved source, a more confident sentence would be an invention."],
        },
      ],
      rationale: "Stated the empty result instead of citing a source that does not exist.",
    };
  }
  const covered = hasDirectCoverage(ctx.topic, ctx.sources);
  const primary = ctx.sources[0];
  const secondary = ctx.sources[1];
  if (!primary) {
    return genericGoodDraft({ ...ctx, sources: [] });
  }
  const first = ` [${primary.id}]`;
  const second = secondary ? ` [${secondary.id}]` : "";
  if (!covered) {
    return {
      title: "The corpus does not cover this",
      summary: `The fixture corpus does not cover “${clip(ctx.topic, 120)}” directly. The honest claim is narrower: a sentence has to point at a source that was actually retrieved.${first}`,
      sections: [
        {
          heading: "What came back",
          paragraphs: [
            `${primary.title} is the closest note, and it does not study the assignment. ${firstSentence(primary.snippet)}${first}`,
          ],
        },
      ],
      rationale: "Hedged the thesis. The topic is not in the retrieved text.",
    };
  }
  return {
    title: clip(ctx.topic, 140),
    summary: `${firstSentence(primary.snippet)}${first}`,
    sections: [
      {
        heading: "From the notes",
        paragraphs: [
          secondary
            ? `${firstSentence(secondary.snippet)}${second}`
            : `That is the claim the retrieved text will support.${first}`,
        ],
      },
    ],
    rationale: "Cited the retrieved notes and dropped the invented source.",
  };
}

function marker(sources: Source[], locator: string): string {
  const match = sources.find((source) => source.locator === locator) ?? sources[0];
  return match ? ` [${match.id}]` : "";
}

function hasDirectCoverage(topic: string, sources: Source[]): boolean {
  const words = topic.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 4 && !STOP.has(word)) ?? [];
  if (words.length === 0) return false;
  const hay = sources.map((source) => `${source.title} ${source.snippet}`).join(" ").toLowerCase();
  const hits = words.filter((word) => hay.includes(word));
  return hits.length >= Math.min(2, words.length);
}

function firstSentence(snippet: string): string {
  const match = snippet.match(/^.+?[.]/);
  return (match?.[0] ?? snippet).replace(/\s+/g, " ").trim().slice(0, 280);
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}
