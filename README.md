# amc-client

A server-only TypeScript client for AMC's HTTP API. Not a toolkit for building other
clients — this *is* the client. Any app that talks to AMC (`amc-demo-template`,
`amc-holiday-planner`, and future demos) imports this directly rather than
hand-rolling its own fetch wrapper.

Extracted from `amc-demo-template`'s `lib/amc.ts` once that repo's usage was proven
against the real AMC backend — see its `PROGRESS.md` for the history.

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

## What's in it

- `submitRaw(model, prompt, systemPrompt)` — one raw Ollama call, no AMC Agent required.
  This is the only submission path that allows a per-call system prompt override; AMC's
  agent-based `/api/jobs` endpoint has none.
- `getJob(jobId)` — fetches a job, and once it's `complete`, merges in the response log
  content (as `output`) and the latest timing entry (as `metrics`) — AMC's job record has
  neither natively.
- `getRunnerStatus()` — public, unauthenticated GPU/runner snapshot.
- `triggerWarmUp()` — best-effort wake nudge; never rejects.

## Publishing

Private package, published to GitHub Packages under the `@jackwaddington` scope (see
`publishConfig` in `package.json`). Consumers need a `.npmrc` pointing that scope at
`npm.pkg.github.com` and a GitHub token with `read:packages`.
