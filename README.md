# Agent Crew

**Live demo: [https://agent-crew.kfairley9999.workers.dev](https://agent-crew.kfairley9999.workers.dev)** (demo mode: scripted agents over a fixed source set, no API key spent)

A planner, a researcher, a writer, and a critic take one assignment and come back with a short brief you can check. You watch the handoffs while they work. The sources under the brief are the ones the researcher actually retrieved.

This is a portfolio project by **Kevin Fairley** for agentic AI roles: a typed orchestration core, a streaming desk, and a demo that does not spend an API key.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)
![Tests](https://img.shields.io/badge/tests-vitest%20%2B%20playwright-6e9b6e)
![License](https://img.shields.io/badge/license-MIT-d1d5db)

![The crew mid-run: the critic rejects a citation that is not on the board](docs/media/lanes-live.png)

![Demo playback of a full run](docs/media/crew-run.gif)

![The signed brief, with sources](docs/media/brief.png)

## What it does

You assign a question. Four roles share one blackboard:

1. **Planner** cuts the question into searches.
2. **Researcher** calls a search tool and keeps only notes those hits support.
3. **Writer** drafts a brief whose markers look like `[1]`.
4. **Critic** sends it back when a claim or a citation does not hold.

The loop stops at a revision cap (default 2). A separate check, not another model, rejects citation ids that were never retrieved. A token and dollar budget is checked before each model call and again after the usage comes back. If the ceiling would break, the crew publishes what it has and says why it stopped.

The desk streams status, short rationales, tool calls, tool results, and handoffs over server-sent events. Lanes are one per role. The paper stays blank until the critic signs off.

## Architecture

The orchestrator does not know it is running on a Worker. The same function drives unit tests, demo playback, and a live Groq call.

```mermaid
flowchart LR
  subgraph desk [React desk]
    Lanes[Lanes per role]
    Paper[Cited brief]
    IDB[(IndexedDB runs)]
  end
  subgraph worker [Hono on Workers]
    API["POST /api/runs"]
    Archive["/api/archive"]
    Gate[Live rate limit]
  end
  subgraph core [Orchestration core]
    Orch[orchestrate]
    Board[Blackboard reducer]
    Budget[Token and cost budget]
    Cap[Critic loop, max revisions]
  end
  Lanes -->|SSE| API
  API --> Gate
  Gate --> Orch
  Orch --> Board
  Orch --> Budget
  Orch --> Cap
  Orch --> Planner
  Orch --> Researcher
  Researcher --> Search[Fixture corpus or Wikipedia]
  Orch --> Writer
  Cap -->|revise| Writer
  Orch --> Critic
  Orch --> Demo[Scripted model]
  Orch --> Groq["Groq, OpenAI-compatible"]
  Paper --- Board
  Lanes --> IDB
  IDB -.->|owner key, only if MONGODB_URI is set| Archive
  Archive -.-> Mongo[(MongoDB runs)]
```

| Piece | Where | Notes |
| --- | --- | --- |
| Messages, blackboard, critic cap, budget | `src/core` | No React, Hono, or Worker imports |
| Scripted model and presets | `src/demo` | Same orchestrator, recorded answers |
| Groq client | `src/llm` | User-Agent, 429 retry, token-bucket reset |
| Search | `src/tools` | Local corpus, or Wikipedia with no key |
| API | `src/worker` | Static assets plus `/api/*`. Optional MongoDB archive |
| Desk | `src/client` | Vite, Tailwind, shadcn-style primitives. IndexedDB |
| Run documents | `src/persist` | Shared shape for a saved run. No IndexedDB, Mongo, or Worker imports |

On Cloudflare, `/api/*` runs the Worker first. Everything else is the Vite build, with SPA fallback. Logs and traces are enabled in `wrangler.jsonc`.

## Saved runs

A run is one document: the blackboard (plan, notes, sources, critiques, per-role status), the event log (thoughts, handoffs, tool calls, tool results), the cited brief, usage, budget, and whether the run was demo or live. The desk writes that document while the crew is working, and again when the run finishes. Opening a saved run restores the lanes, the brief, and the citations. It does not start the crew again.

Demo runs stay labeled **Demo**. A scripted trace uses model `demo-scripted` and evidence `fixture-corpus`. The desk will not present that as a live Groq call, including after a refresh.

**IndexedDB is the default.** The browser keeps documents in a database named `agent-crew`, object store `runs`. No account, no secret, and no cloud. This is what the public demo and CI use. Refresh the page and the saved-runs list is still there. If the browser refuses storage (private mode or a full quota), the desk says so and the run on screen keeps working until you leave the page.

**MongoDB is optional and off until `MONGODB_URI` is set.** The URI stays on the Worker. It is not in the client bundle, not in logs, and not in `/api/config`. Optional `MONGODB_DB_NAME` defaults to `agent_crew`. The collection is `runs`. When the secret is set, config reports `archive.server: "mongodb"` and the desk also PUTs each snapshot to the Worker. When it is unset, `/api/archive/*` responds with `archive_off` and the desk uses IndexedDB only.

The archive API is owner-scoped. The desk sends `X-Owner-Key` (or `Authorization: Bearer`), a random 32-byte secret kept in IndexedDB. The Worker stores the SHA-256 of that key as `ownerId` and returns only that owner's documents. Requests without the key are rejected. There is no shared password in the client.

A refresh opens the last snapshot. It does not reattach to a stream that was still in progress. A run saved mid-flight is labeled as a snapshot.

### Document shape

IndexedDB stores the run with `id`. MongoDB stores the same fields with `_id` set to that id.

| Field | What it is |
| --- | --- |
| `id` / `_id` | Run id |
| `ownerId` | SHA-256 of the browser's owner key |
| `topic`, `mode`, `status`, `model`, `evidence` | Assignment and how it was run. `mode` is `demo` or `live` |
| `createdAt`, `updatedAt`, `finishedAt` | ISO timestamps. `finishedAt` is null while the run is still going |
| `usage`, `budget` | Token totals, dollar cost, call count, and the ceilings |
| `eventCount`, `sourceCount` | Denormalized counts on the MongoDB document |
| `blackboard` | Plan, sources, notes, critiques, per-role status, event log, and the cited brief |

Suggested index once a cluster exists: `{ ownerId: 1, updatedAt: -1 }` on `runs`.

### Turning MongoDB on later

Nothing in this repo creates a cluster, enables billing, or deploys. A free Atlas M0 is enough when you want the server archive.

1. Create an M0 cluster and a database user that can read and write `agent_crew`. Workers do not have a fixed egress IP, so Atlas network access for this demo is typically `0.0.0.0/0`.
2. Locally, put the URI in `.dev.vars` (see `.dev.vars.example`). `npm run dev` reads `MONGODB_URI` and optional `MONGODB_DB_NAME`. Do not commit `.dev.vars`.
3. On Cloudflare, `npx wrangler secret put MONGODB_URI`. That command deploys a new version. Optional: `npx wrangler secret put MONGODB_DB_NAME`. The secret is not listed in `secrets.required`, so a deploy without it still succeeds and the public demo stays on IndexedDB. After the secret exists, later deploys keep it.
4. `wrangler dev` only injects secrets named in `secrets.required` (today `GROQ_API_KEY`). Use `npm run dev` to try the archive locally.

The Worker uses the official `mongodb` Node.js driver. Cloudflare documents that driver on Workers through `node:net` and `node:tls`. This project already sets `nodejs_compat` and `compatibility_date` `2026-11-08`. The driver is loaded with a dynamic import only while an archive request runs and the secret is set. A demo isolate that never opens a database does not evaluate it. Tests mock the collection. CI does not need a cluster.

## Quickstart

Node 22 or newer.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). Pick a preset and run the crew. Demo mode is the default. It does not call Groq.

```bash
npm test          # vitest: orchestration, budget, 429 parser, API
npm run test:e2e  # Playwright against the built desk in demo mode
npm run typecheck # wrangler types, then tsc
npm run build
```

`npm run dev` is Vite on port 43123 plus the Hono app on port 44731. `npm run preview` serves the production build and the API on one port, which is what the smoke test uses. `npm run dev:worker` is `wrangler dev` after a build.

## Demo mode and live mode

Demo is the public path. With no `GROQ_API_KEY`, live requests are rejected. The scripted model is not a fake event tape: it answers the same JSON schemas the live model is asked for, including a first draft that cites a source the researcher never retrieved. The critic sends that back. The second draft cites only real ids. Playback delays live in the HTTP layer, so tests run the loop with no sleeps.

Live mode is opt-in in the UI, and only if the secret is present.

- Provider: OpenAI-compatible chat completions
- Default base URL: `https://api.groq.com/openai/v1`
- Default model: `qwen/qwen3.8-27b` (`GROQ_MODEL` overrides it)
- Every request sets `User-Agent: AgentCrew/1.0 (Kevin Fairley portfolio; +https://github.com/kfairy9999)`. Groq's edge blocks empty and library-default agents.
- A 429 waits for the later of `Retry-After`, `x-ratelimit-reset-tokens`, and `x-ratelimit-reset-requests` (durations like `250ms`, `7.66s`, `6m0s`). The client will not block past 15 seconds. The provider message "try again in 1.2s" is a fallback when headers are missing.
- Search in live mode is the Wikipedia API. No second key. It sends the same user agent, which Wikimedia requires.
- Live runs are rate limited: 2 per 10 minutes per IP, and 4 per 10 minutes for the isolate. That map dies with the isolate. It is a guardrail, not an account-wide limiter. The per-run budget defaults to 8,000 tokens and $0.05 at the planning rates in `wrangler.jsonc`.

Copy `.dev.vars.example` to `.dev.vars` for local live mode. Do not commit the key.

## Deploy

This repo is ready to deploy and has not been deployed from here. A dry run bundles the Worker and the static assets locally.

Demo-only (no key, no spend):

```bash
npm ci
npm run build
npx wrangler login
npx wrangler deploy
```

Live mode, after the demo deploy is up:

```bash
npx wrangler secret put GROQ_API_KEY
```

`wrangler secret put` creates a new version and deploys it. The secret is not in `wrangler.jsonc`. `secrets.required` only names `GROQ_API_KEY` so `wrangler types` knows it exists, and so a missing secret fails deploy. An empty `GROQ_API_KEY` keeps the desk in demo mode.

The run archive is separate. Leave `MONGODB_URI` unset and runs stay in IndexedDB. See [Saved runs](#saved-runs). Do not put the URI in `wrangler.jsonc` or in the client.

Useful checks before you ship a change:

```bash
npx wrangler types
npx wrangler deploy --dry-run
```

Config worth knowing:

- `compatibility_date` is `2026-11-08`, with `nodejs_compat`
- `assets.run_worker_first` is `["/api/*"]`
- `observability.logs` and `observability.traces` are on
- Preview URLs on `workers.dev` are public unless you put Access in front of them

## How it was built

I designed and directed this project and built it with AI coding agents: I set the requirements (a shared blackboard, a critic that can only send a draft back twice, citations checked against what was actually retrieved, a hard token budget, and a keyless demo mode), reviewed the results, and drove the fixes.

## What I learned

The interesting bugs were not in the prompts.

A critic that can only say "revise" will revise forever. The cap has to be in the orchestrator, and the unresolved issues have to ship with the brief. Otherwise the trace hides the disagreement.

Citation ids cannot be the model's job. If the writer is allowed to emit a bibliography, it will invent one. The source list stays on the blackboard. A pure function rejects unknown markers even when the critic approves.

The budget check has to happen twice. An estimate before the call keeps you from starting a request you cannot afford. The usage object after the call catches the estimate being wrong. Stopping there is a successful run, if you still publish the draft you have.

Demo mode was tempting to fake in the UI. Playing a script through the real loop meant the smoke test and the unit tests exercise one code path. The script's job is to be wrong once, on purpose.

Groq's 429 is two buckets. `Retry-After` alone was not enough. The token reset header is often the longer wait, and it is a duration string, not a number of seconds. I also had to send a User-Agent. The default agent is blocked before the model sees the body.

SSE on one request is enough for a run that finishes in seconds. The abort signal has to reach `fetch`, or a visitor who hits Stop still spends the key. I would not use this shape for a run that must survive a disconnected tab. That wants a Durable Object or a Workflow, and it can wait until a run is actually longer than a request. A refresh can reopen the saved snapshot. That is the document from the last write, not a reattached stream.

The isolate-local rate limit will not save a key from a determined client that lands on fresh isolates. The budget and the "demo unless a secret is set" switch are the controls that matter. The limiter is there so a single warm isolate cannot be used as an open proxy.

## Roadmap

- A Durable Object so a refresh can reattach to a run that is still streaming. Saved snapshots already reopen after a refresh; they do not resume a live model call
- A second provider behind the same `LlmClient`, including Workers AI
- Search that can fail on purpose in the eval set, not only in a mock
- Score the mechanical checks across a frozen set of topics before asking another model to grade prose
- Per-user budgets once there is an account, instead of an isolate map

## License

MIT. See [LICENSE](LICENSE).
