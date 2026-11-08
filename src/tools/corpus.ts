import type { SearchHit } from "../core/types";

export interface FixtureDoc {
  id: string;
  title: string;
  keywords: string[];
  text: string;
}

export const FIXTURE_CORPUS: readonly FixtureDoc[] = [
  {
    id: "blackboard",
    title: "Shared blackboard",
    keywords: ["blackboard", "reducer", "handoff", "snapshot", "consistency", "serialized"],
    text: "A shared blackboard is the crew's only memory. Each agent proposes a typed write — a plan, a source, a note, a draft, a critique — and a single reducer applies it. The next agent reads that snapshot, not a private chat log. Consistency comes from the reducer, not from hoping two prompts remember the same fact. Concurrent writers are not safe: two critiques applied out of order can resurrect a claim the other one deleted. The practical rule is one writer at a time, with an explicit handoff that names what the next role is allowed to change.",
  },
  {
    id: "critic-loop",
    title: "Critic loops and revision caps",
    keywords: ["critic", "revision", "cap", "loop", "reservation"],
    text: "A critic loop sends a draft back to the writer with a list of defects. It is useful when the defect is local: a missing citation, a hedge that should be there, a section that does not answer the question. It is not a search strategy. If the evidence is absent, another revision only polishes a guess. Cap the loop. Two revisions is enough to fix structure; a further pass usually restates the last one. When the cap is hit, publish the draft with the unresolved issues attached, so a reader sees the reservation instead of a false clean bill.",
  },
  {
    id: "budgets",
    title: "Token and dollar budgets",
    keywords: ["budget", "tokens", "cost", "ceiling", "meter"],
    text: "Every model call should pass a budget check before it is sent. Track prompt tokens, completion tokens, and a price table, and stop when either the token ceiling or the dollar ceiling would break. The check has to happen before the call, using a conservative estimate, and again after the usage comes back, because estimates lie. A budget stop is a successful control, not a crash: if a draft already exists, publish it and say why the crew halted. Demo mode should still move the meter, using synthetic usage, so the same UI is honest about cost when a real key is absent.",
  },
  {
    id: "citations",
    title: "Citations point at retrieved sources",
    keywords: ["citation", "source", "grounding", "retrieved", "marker"],
    text: "A citation is a pointer to a source the researcher actually retrieved. The writer may use a marker like [1] only when that id is on the blackboard. A separate check, not another language model, should reject unknown ids. Models will invent a bibliography if asked to add sources in prose. Keep the source list on the orchestrator and let the model write claims. If the snippets do not support a sentence, the sentence does not ship. A short clause is the most a snippet should contribute; the rest is paraphrase.",
  },
  {
    id: "hiring",
    title: "What hiring managers read in an agent portfolio",
    keywords: ["hiring", "portfolio", "trace", "engineer", "manager"],
    text: "Hiring managers reading an agentic AI portfolio look for a system boundary they can test. A loop diagram is not enough. They want a typed message protocol, a state object they can fold in a unit test, a tool call that can fail, a limit that stops a runaway critic, and a demo that does not spend their API key. Taste shows up in the trace: can a stranger tell which agent decided what, and can they open the source behind a claim? Streaming the trace matters more than a chat box that reveals only the final paragraph.",
  },
  {
    id: "search-vs-critique",
    title: "Search when evidence is missing",
    keywords: ["search", "critique", "evidence", "query", "revise"],
    text: "Search and critique answer different failures. Search is for missing evidence. Critique is for a draft that misuses evidence you already hold. If the critic says a claim is not supported, the next move is sometimes another query, not another adjective. If the critic says a citation does not exist, the writer can fix it without the network. A crew that only revises will sound more confident and become less true. A crew that only searches will never finish the paragraph.",
  },
  {
    id: "traces",
    title: "Streaming traces for the operator",
    keywords: ["trace", "streaming", "sse", "lanes", "handoff", "operator"],
    text: "An operator trusts a crew when the trace shows status, a short rationale, tool calls, tool results, and handoffs as they happen. Server-sent events fit a single run: one HTTP response, many events, and an abort that cancels the upstream model call. Lanes per agent are easier to read than a single mixed log once four roles speak. The trace is also the test oracle. If you cannot assert that the critic ran after the writer, you do not have a crew. You have a prompt.",
  },
  {
    id: "eval",
    title: "Small evals for agent behavior",
    keywords: ["eval", "fixture", "test", "score", "citation"],
    text: "A small eval set beats a vibe check. Freeze a handful of topics, the tool results, and the expected defects. Run the orchestrator on a scripted model in CI, then run the live model on a schedule when a key exists. Score whether citations resolve, whether the revision cap holds, and whether a budget of a few cents stops the loop. Do not score prose with another model until the mechanical checks are boring and green.",
  },
];

export function getFixture(id: string): FixtureDoc | undefined {
  return FIXTURE_CORPUS.find((doc) => doc.id === id);
}

export function fixtureHit(doc: FixtureDoc): SearchHit {
  return {
    title: doc.title,
    url: `/api/fixtures/${doc.id}`,
    snippet: doc.text,
    locator: `fixture:${doc.id}`,
  };
}
