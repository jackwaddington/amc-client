import { extendZodWithOpenApi, OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import type { OpenAPIObject } from 'openapi3-ts/oas31'
import { z } from 'zod'

extendZodWithOpenApi(z)

const registry = new OpenAPIRegistry()

const JobMetric = registry.register(
  'JobMetric',
  z.object({
    model: z.string(),
    totalDurationNs: z.number(),
    loadDurationNs: z.number(),
    promptEvalCount: z.number(),
    promptEvalDurationNs: z.number(),
    evalCount: z.number(),
    evalDurationNs: z.number(),
    doneReason: z.string(),
  }),
)

const Job = registry.register(
  'Job',
  z.object({
    id: z.string(),
    status: z.string(),
    output: z.string().optional().describe(
      "Present once AMC has a completed result to show — merged in by getJob() from a separate log entry.",
    ),
    agentName: z.string().optional().describe('Present for agent-based jobs.'),
    metrics: JobMetric.optional().describe('Present once AMC has recorded timing data for the call.'),
  }),
)

const JobGroup = registry.register(
  'JobGroup',
  z.object({
    id: z.string(),
    status: z.string(),
    jobs: z.array(Job),
  }),
)

const RunnerStatus = registry.register(
  'RunnerStatus',
  z.object({
    online: z.boolean(),
    queuedJobs: z.number(),
    runningJobs: z.number(),
  }),
)

const ApiError = registry.register(
  'ApiError',
  z.object({
    message: z.string(),
  }),
)

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'AMC Project API key, sent as `Authorization: Bearer <apiKey>`.',
})

registry.registerPath({
  method: 'post',
  path: '/api/jobs/raw',
  summary: 'Submit a raw Ollama call',
  description:
    'Submits a single raw Ollama call (model + prompt + systemPrompt), with no AMC Agent involved. ' +
    'The only submission path that allows a per-call system prompt override.',
  tags: ['Jobs'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            model: z.string(),
            prompt: z.string(),
            systemPrompt: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The created Job_Group, containing one Job.',
      content: { 'application/json': { schema: JobGroup } },
    },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{jobId}',
  summary: 'Get a job',
  description:
    'Fetches a job by id. This client library additionally merges in log-derived `output` and the ' +
    'latest `metrics` entry once the job is complete — the raw AMC response carries neither natively.',
  tags: ['Jobs'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ jobId: z.string() }),
  },
  responses: {
    200: {
      description: 'The requested Job.',
      content: { 'application/json': { schema: Job } },
    },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
    404: { description: 'No job with that id', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/public/runner-status',
  summary: 'Get runner status',
  description: 'Public, unauthenticated GPU/runner online-queued-running snapshot.',
  tags: ['Runner'],
  responses: {
    200: {
      description: 'Current runner status.',
      content: { 'application/json': { schema: RunnerStatus } },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/public/warm-up',
  summary: 'Trigger a warm-up',
  description:
    'Best-effort GPU wake-up nudge, public and unauthenticated. This client silently no-ops on ' +
    'any failure — callers should never need to handle this rejecting.',
  tags: ['Runner'],
  responses: {
    200: { description: 'Warm-up accepted.' },
  },
})

export function generateOpenApiDocument(): OpenAPIObject {
  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'AMC API',
      version: '0.1.0',
      description:
        'The subset of AMC\'s HTTP API covered by `@jackwaddington/amc-client`. See the ' +
        '[amc-client README](https://github.com/jackwaddington/amc-client) for the TypeScript client.',
    },
    servers: [{ url: 'https://amc.jackwaddington.com' }],
  })
}
