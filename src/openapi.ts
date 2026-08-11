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
    tag: z.string().max(100).nullable().optional().describe(
      'Optional free-text stamp for grouping separate submissions at query time.',
    ),
    jobs: z.array(Job),
  }),
)

const RunnerState = z.enum([
  'unknown',
  'asleep',
  'waking',
  'starting',
  'idle',
  'busy',
  'unreachable',
])

const RunnerStatus = registry.register(
  'RunnerStatus',
  z.object({
    online: z.boolean(),
    state: RunnerState,
    queuedJobs: z.number(),
    runningJobs: z.number(),
    gpuName: z.string().nullable(),
    vramMb: z.number().nullable(),
    defaultModel: z.string().nullable(),
    models: z.array(z.object({
      name: z.string(),
      state: z.enum(['loaded', 'loading']),
      observedAt: z.string().nullable(),
      sizeVramBytes: z.number().nullable(),
      expiresAt: z.string().nullable(),
      lastLoadDurationMs: z.number().nullable(),
    })),
    runners: z.array(z.object({
      runnerId: z.string(),
      state: RunnerState,
      wakeable: z.boolean(),
      warmModel: z.string().nullable(),
      gpuName: z.string().nullable(),
      vramMb: z.number().nullable(),
      lastHeartbeatAt: z.string().nullable(),
    })),
  }),
)

const ApiError = registry.register(
  'ApiError',
  z.object({
    message: z.string(),
  }),
)

const Project = registry.register(
  'Project',
  z.object({
    id: z.string(),
    userId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    promptPrefix: z.string(),
    promptSuffix: z.string(),
    dailyJobLimit: z.number().nullable(),
    publicStatus: z.enum(['none', 'pending', 'approved']),
    publicUrl: z.string().nullable(),
    publicRequestedAt: z.string().nullable(),
    publicApprovedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
    agentCount: z.number(),
    jobCount: z.number(),
    tokenCount: z.number(),
    latestActivityAt: z.string().nullable(),
  }),
)

const Agent = registry.register(
  'Agent',
  z.object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    model: z.string(),
    systemPrompt: z.string(),
    promptSuffix: z.string(),
    assistantPrefill: z.string(),
    avatar: z.string().nullable(),
    tools: z.array(z.string()),
    managedBy: z.enum(['user', 'admin', 'sysadmin']),
    triggeredBy: z.enum(['human_only', 'any_agent', 'human_initiated_chain']),
    minimumChainRole: z.enum(['user', 'admin', 'sysadmin']),
    publishApproval: z.enum(['auto', 'requires_human_confirmation']),
    delegateToAgents: z.boolean(),
    createdById: z.string(),
    createdAt: z.string(),
    deletedAt: z.string().nullable(),
    skills: z.array(z.string()),
    knowledgeBases: z.array(z.string()),
    turnLimit: z.number(),
  }),
)

const Batch = registry.register(
  'Batch',
  z.object({
    id: z.string(),
    projectId: z.string(),
    name: z.string().nullable(),
    repeatN: z.number(),
    totalJobs: z.number(),
    completedJobs: z.number(),
    status: z.enum(['pending', 'running', 'complete', 'partial', 'failed']),
    userId: z.string(),
    createdAt: z.string(),
  }),
)

const BatchGroupJob = registry.register(
  'BatchGroupJob',
  z.object({
    id: z.string(),
    groupId: z.string(),
    agentId: z.string().nullable(),
    agentName: z.string().nullable(),
    agentSystemPrompt: z.string().nullable(),
    agentPromptSuffix: z.string().nullable(),
    effectiveModel: z.string().nullable(),
    status: z.string(),
    type: z.string(),
    position: z.number(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
    response: z.string().nullable(),
  }),
)

const BatchGroup = registry.register(
  'BatchGroup',
  z.object({
    id: z.string(),
    projectId: z.string(),
    groupNumber: z.number(),
    name: z.string().nullable(),
    prompt: z.string(),
    isPublic: z.boolean(),
    userId: z.string(),
    originatingRole: z.string(),
    createdAt: z.string(),
    parentGroupId: z.string().nullable(),
    sweepId: z.string().nullable(),
    sweepVariables: z.unknown().nullable(),
    batchId: z.string().nullable(),
    batchVariables: z.unknown().nullable(),
    chainTotal: z.number().nullable(),
    chainIntro: z.string().nullable(),
    stages: z.unknown().nullable(),
    userServices: z.unknown().nullable(),
    deletedAt: z.string().nullable(),
    deletedBy: z.string().nullable(),
    apiKeyId: z.string().nullable(),
    lessonId: z.string().nullable(),
    jobs: z.array(BatchGroupJob),
  }),
)

const BatchDetail = registry.register(
  'BatchDetail',
  Batch.extend({
    projectPromptPrefix: z.string(),
    projectPromptSuffix: z.string(),
    groups: z.array(BatchGroup),
  }),
)

const BatchSubmitInput = registry.register(
  'BatchSubmitInput',
  z.object({
    name: z.string().optional(),
    promptIds: z.array(z.string()),
    preambleIds: z.array(z.string()).optional(),
    suffixIds: z.array(z.string()).optional(),
    prefillIds: z.array(z.string()).optional(),
    modelIds: z.array(z.string()),
    repeatN: z.number().optional(),
    agentId: z.string(),
    controlPreamble: z.boolean().optional(),
    controlSuffix: z.boolean().optional(),
    controlPrefill: z.boolean().optional(),
  }),
)

const Note = registry.register(
  'Note',
  z.object({
    id: z.string(),
    projectId: z.string(),
    jobGroupId: z.string().nullable(),
    jobId: z.string().nullable(),
    body: z.string(),
    author: z.enum(['human', 'api']),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
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
            tag: z.string().max(100).optional().describe(
              'Optional free-text Job_Group tag stamped at submit time.',
            ),
            temperatures: z.array(z.number().min(0).max(2)).max(12).optional().describe(
              'Temperature sweep — one job per value, for side-by-side comparison. Omit for a ' +
                "single job at Ollama's default temperature.",
            ),
            topK: z.number().int().optional().describe('Ollama `options.top_k`.'),
            topP: z.number().min(0).max(1).optional().describe('Ollama `options.top_p`.'),
            repeatPenalty: z.number().optional().describe('Ollama `options.repeat_penalty`.'),
            numPredict: z.number().int().min(-1).optional().describe(
              'Ollama `options.num_predict` — max tokens to generate (-1 = no limit).',
            ),
            mirostat: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe(
              'Ollama `options.mirostat` — 0 = off, 1 = mirostat, 2 = mirostat2.',
            ),
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
  method: 'get',
  path: '/api/projects',
  summary: 'List projects',
  description: 'Lists Projects visible to this API key. Read-only — see the Project schema notes on writes.',
  tags: ['Projects'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({ status: z.enum(['active', 'archived']).optional() }),
  },
  responses: {
    200: { description: 'Matching Projects.', content: { 'application/json': { schema: z.array(Project) } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/projects/{id}',
  summary: 'Get a project',
  tags: ['Projects'],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'The requested Project.', content: { 'application/json': { schema: Project } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
    404: { description: 'No project with that id', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/projects/{projectId}/agents',
  summary: 'List agents',
  description: 'Lists Agents configured on a Project. Read-only, same as Projects.',
  tags: ['Agents'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ projectId: z.string() }),
    query: z.object({ status: z.enum(['active', 'archived', 'all']).optional() }),
  },
  responses: {
    200: { description: 'Matching Agents.', content: { 'application/json': { schema: z.array(Agent) } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/projects/{projectId}/agents/{agentId}',
  summary: 'Get an agent',
  tags: ['Agents'],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ projectId: z.string(), agentId: z.string() }) },
  responses: {
    200: { description: 'The requested Agent.', content: { 'application/json': { schema: Agent } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
    404: { description: 'No agent with that id', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/batches',
  summary: 'List batches',
  description: 'Omit `projectId` to use the key\'s own Project.',
  tags: ['Batches'],
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ projectId: z.string().optional() }) },
  responses: {
    200: { description: 'Matching Batches.', content: { 'application/json': { schema: z.array(Batch) } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/batches/{id}',
  summary: 'Get a batch',
  description: 'Fetches one Batch, including its job groups and jobs.',
  tags: ['Batches'],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'The requested Batch.', content: { 'application/json': { schema: BatchDetail } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
    404: { description: 'No batch with that id', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/batches',
  summary: 'Submit a batch',
  description:
    'Submits a matrix Batch (prompt/model/etc. combinations against one Agent). Omit `projectId` in the ' +
    'body to use the key\'s own Project.',
  tags: ['Batches'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: BatchSubmitInput.extend({ projectId: z.string().optional() }) },
      },
    },
  },
  responses: {
    201: {
      description: 'The created Batch.',
      content: { 'application/json': { schema: BatchDetail.extend({ groupCount: z.number() }) } },
    },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

const noteBodyInput = z.object({ body: z.string() })

registry.registerPath({
  method: 'get',
  path: '/api/projects/{projectId}/notes',
  summary: 'List notes on a project',
  tags: ['Notes'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ projectId: z.string() }),
    query: z.object({ scope: z.enum(['all', 'project']).optional() }),
  },
  responses: {
    200: { description: 'Matching Notes.', content: { 'application/json': { schema: z.array(Note) } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/projects/{projectId}/notes',
  summary: 'Create a note on a project',
  description: '`author` is derived server-side from the credential — never sent by the client.',
  tags: ['Notes'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ projectId: z.string() }),
    body: { content: { 'application/json': { schema: noteBodyInput } } },
  },
  responses: {
    201: { description: 'The created Note.', content: { 'application/json': { schema: Note } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/job-groups/{id}/notes',
  summary: 'List notes on a job group',
  tags: ['Notes'],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Matching Notes.', content: { 'application/json': { schema: z.array(Note) } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/job-groups/{id}/notes',
  summary: 'Create a note on a job group',
  tags: ['Notes'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: noteBodyInput } } },
  },
  responses: {
    201: { description: 'The created Note.', content: { 'application/json': { schema: Note } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/jobs/{id}/notes',
  summary: 'List notes on a job',
  tags: ['Notes'],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Matching Notes.', content: { 'application/json': { schema: z.array(Note) } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/jobs/{id}/notes',
  summary: 'Create a note on a job',
  tags: ['Notes'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: noteBodyInput } } },
  },
  responses: {
    201: { description: 'The created Note.', content: { 'application/json': { schema: Note } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/notes/{id}',
  summary: 'Update a note',
  tags: ['Notes'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: noteBodyInput } } },
  },
  responses: {
    200: { description: 'The updated Note.', content: { 'application/json': { schema: Note } } },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
    404: { description: 'No note with that id', content: { 'application/json': { schema: ApiError } } },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/api/notes/{id}',
  summary: 'Delete a note',
  tags: ['Notes'],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted.' },
    401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: ApiError } } },
    404: { description: 'No note with that id', content: { 'application/json': { schema: ApiError } } },
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
        'The subset of AMC\'s HTTP API covered by `@jackwaddington/amc-client`: raw job submission, ' +
        'read access to Projects/Agents/Batches, full read/write on Notes and Batches, and the public ' +
        'runner status snapshot. See the ' +
        '[amc-client README](https://github.com/jackwaddington/amc-client) for the TypeScript client.',
    },
    servers: [{ url: 'https://amc.jackwaddington.com' }],
  })
}
