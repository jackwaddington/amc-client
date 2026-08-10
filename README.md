# amc-client

[![npm](https://img.shields.io/npm/v/@jackwaddington/amc-client)](https://www.npmjs.com/package/@jackwaddington/amc-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A TypeScript client for [AMC](https://amc.jackwaddington.com)'s HTTP API — submit a
prompt, poll a job to completion, and check whether the runner is online. Server-side
only: it needs your AMC API key, which must never reach a browser bundle.

## Install

```sh
npm install @jackwaddington/amc-client
```

## Getting an API key

Create a Project in the AMC console, then generate an API key from that project's
Settings tab. Keys are scoped to a single project and can be revoked at any time.

## Usage

```ts
import { createAmcClient } from '@jackwaddington/amc-client'

const amc = createAmcClient({
  apiKey: process.env.AMC_API_KEY!, // server-only — never expose this to a browser bundle
  baseUrl: process.env.AMC_API_BASE_URL, // optional, defaults to https://amc.jackwaddington.com
})

const group = await amc.submitRaw('llama3.2:latest', 'Fire at Main St', 'You are a dispatcher.')
const job = await amc.getJob(group.jobs[0].id) // output/metrics merged in once complete
const status = await amc.getRunnerStatus() // public, no auth needed

const [project] = await amc.listProjects()
const [agent] = await amc.listAgents(project.id)
const batch = await amc.submitBatch({
  promptIds: ['prompt-1'],
  modelIds: ['llama3.2:latest'],
  agentId: agent.id,
})
await amc.createNote({ level: 'project', projectId: project.id }, 'Kicked off the batch above.')
```

## OpenAI-compatible endpoint (no SDK needed)

If the caller already speaks the OpenAI API — LangChain, Open WebUI, the `openai`
package itself, plain curl — it doesn't need this SDK at all. Point its `base_url` at
AMC and use an AMC API key as the bearer token; calls are answered synchronously and
still recorded as a job — prompt, response, timing, and token metrics land in the
console like any other run.

```python
from openai import OpenAI

client = OpenAI(base_url="https://amc.jackwaddington.com/v1", api_key="amc_sk_...")
r = client.chat.completions.create(
    model="gemma3:1b",
    messages=[{"role": "user", "content": "Hello"}],
)
```

- `POST /v1/chat/completions` — synchronous, non-streaming (`stream: true` returns a
  400 for now); standard `choices[].message.content` / `usage.*` response shape.
- `GET /v1/models` — model list in OpenAI's shape, for model-picker UIs.

Reach for this when the goal is "plug AMC into something that already talks OpenAI."
Use this SDK instead when you want AMC's own job/agent/batch model: async submission
you poll, a per-call system-prompt override, Batches, Notes, and runner status.

## API

- `submitRaw(model, prompt, systemPrompt)` — one raw Ollama call, no AMC Agent required.
  This is the only submission path that allows a per-call system prompt override; AMC's
  agent-based `/api/jobs` endpoint has none.
- `getJob(jobId)` — fetches a job, and once it's `complete`, merges in the response log
  content (as `output`) and the latest timing entry (as `metrics`) — AMC's job record has
  neither natively.
- `getRunnerStatus()` — public, unauthenticated runner fleet snapshot. Read `state`
  (`idle` / `busy` / `starting` / `waking` / `asleep` / `unreachable` / `unknown`): it
  separates a machine resting between jobs, which wakes on demand, from one that has
  actually fallen over. `runners` carries the same per-machine.
- `listProjects(options?)` / `getProject(projectId)` — read-only. A Project API key
  cannot create or update Projects on any AMC surface (REST or MCP), so this client has
  no such method either — see [Scope](#scope).
- `listAgents(projectId, options?)` / `getAgent(projectId, agentId)` — read-only, same
  restriction as Projects.
- `listBatches(projectId?)` / `getBatch(batchId)` / `submitBatch(input, projectId?)` —
  full read/write; omit `projectId` to use the key's own Project.
- `listNotes(target)` / `createNote(target, body)` / `updateNote(noteId, body)` /
  `deleteNote(noteId)` — full read/write. `target` is `{ level: 'project' | 'group' | 'job', ... }`
  identifying what the Note attaches to; `author` is always derived server-side from the
  credential, never sent by the client.

## Live updates (SSE)

`watchRunnerStatus` and `watchJob` subscribe to AMC's live event streams instead of
polling `getRunnerStatus()` / `getJob()` in a loop. Both return a function that closes
the subscription:

```ts
const stopStatus = amc.watchRunnerStatus(
  (status) => console.log(status.state, status.gpuName),
  (error) => console.error('runner status stream failed', error),
)

const stopJob = amc.watchJob(
  group.jobs[0].id,
  (job) => console.log(job.status, job.output),
  (error) => console.error('job stream failed', error),
)

// later
stopStatus()
stopJob()
```

Reconnection is automatic — both on AMC's routine ~55-minute connection rotation and on
unexpected drops (the latter with capped exponential backoff). Neither method falls back
to polling on its own: a permanent failure (e.g. a 404 because live updates are disabled
server-side, or a bad key) calls `onError` once and stops, and it's up to the caller to
decide whether to fall back to `getRunnerStatus()` / `getJob()` themselves. `watchJob`'s
underlying stream is project-wide rather than per-job, so it filters client-side and
re-fetches via `getJob()` on any matching event — a caller subscribing to many jobs at
once opens one connection per `watchJob` call, not a shared one.

The event schema on the wire (`stream.ready`, `runner.status.changed`, `job.status.changed`,
etc.) is internal and only versioned by a `version: 1` field for now, not a stabilized
public contract — this is why `watchRunnerStatus`/`watchJob` hand you the same `RunnerStatus`/
`Job` shapes as the rest of this SDK rather than the raw event envelope, and why it's worth
treating the exact events as an implementation detail that could change.

## Error handling

Failed requests reject with `AmcApiError`, carrying the HTTP `status` and any parsed
response `data`:

```ts
import { AmcApiError, createAmcClient } from '@jackwaddington/amc-client'

try {
  await amc.getJob('does-not-exist')
} catch (error) {
  if (error instanceof AmcApiError) {
    console.error(error.status, error.message, error.data)
  }
}
```

## Scope

This client wraps one-off raw model calls, job/runner status, read access to Projects
and Agents, and full read/write on Batches and Notes. It does **not** cover Project or
Agent creation/updates: this client always authenticates as a Project API key, and AMC
rejects Project/Agent administration from that credential on every surface (REST and
MCP alike) — only a human console session, or an MCP client holding a user-consented
`mcp:admin` OAuth grant, can create or update a Project or Agent. See
[`docs/api/command-surfaces.md`](https://github.com/jackwaddington/amc/blob/main/docs/api/command-surfaces.md)
in the main AMC repo for the full REST/MCP/SDK breakdown and why. For that fuller
programmatic surface, see AMC's [remote MCP server](https://amc.jackwaddington.com); for
the complete HTTP surface underneath both, see the
[API reference](https://jackwaddington.github.io/amc-client/).

## API docs

An OpenAPI 3.1 spec for the endpoints this client calls is generated from
[`src/openapi.ts`](src/openapi.ts) via `pnpm run docs:openapi`, and rendered with
Swagger UI at [`docs/index.html`](docs/index.html), published to
[jackwaddington.github.io/amc-client](https://jackwaddington.github.io/amc-client/) on
every push to `main`.

## Contributing / development

```sh
pnpm install
pnpm test
pnpm run build
```

## License

[MIT](LICENSE)
