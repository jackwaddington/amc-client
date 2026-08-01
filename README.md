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
```

## API

- `submitRaw(model, prompt, systemPrompt)` — one raw Ollama call, no AMC Agent required.
  This is the only submission path that allows a per-call system prompt override; AMC's
  agent-based `/api/jobs` endpoint has none.
- `getJob(jobId)` — fetches a job, and once it's `complete`, merges in the response log
  content (as `output`) and the latest timing entry (as `metrics`) — AMC's job record has
  neither natively.
- `getRunnerStatus()` — public, unauthenticated GPU/runner snapshot.
- `triggerWarmUp()` — best-effort wake nudge; never rejects.

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

This client wraps the subset of AMC's HTTP API needed for one-off raw model calls plus
job/runner status — it does not yet cover Projects, Agents, or Batches. For a full
programmatic surface (including Project/Agent management), see AMC's
[remote MCP server](https://amc.jackwaddington.com); for the complete HTTP surface
underneath both, see the [API reference](https://jackwaddington.github.io/amc-client/).

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
