import type {
  Job,
  JobGroup,
  RunnerStatus,
  JobMetric,
  Project,
  Agent,
  Batch,
  BatchDetail,
  BatchSubmitInput,
  Note,
  NoteTarget,
  NoteListTarget,
} from './types.js'
import { openEventStream } from './sseStream.js'

export class AmcApiError extends Error {
  readonly status: number
  readonly data: unknown

  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.name = 'AmcApiError'
    this.status = status
    this.data = data
  }
}

export interface AmcClientConfig {
  /** Bearer token sent as `Authorization: Bearer <apiKey>` on authed calls. Server-only —
   *  never pass this into a browser bundle. */
  apiKey: string
  baseUrl?: string
}

export interface AmcClient {
  /** Submits a single raw Ollama call (model + prompt + systemPrompt, no agent) — the
   *  only submission path that lets the caller override the system prompt per call; AMC's
   *  agent-based `/api/jobs` endpoint has no per-call systemPrompt override. */
  submitRaw(model: string, prompt: string, systemPrompt: string): Promise<JobGroup>
  /** Fetches a job by id. Once it's `complete`, also fetches and merges in the response
   *  log content (as `output`) and the latest timing entry (as `metrics`) — AMC's job
   *  record carries neither natively. */
  getJob(jobId: string): Promise<Job>
  /** Public, unauthenticated — AMC's runner fleet snapshot: canonical `state`, queue
   *  counts, GPU, loaded models, and per-runner detail in `runners`. */
  getRunnerStatus(): Promise<RunnerStatus>
  /** Public, unauthenticated — subscribes to live runner status over SSE instead of
   *  polling `getRunnerStatus()`. `onUpdate` fires with the full snapshot on connect and
   *  on every subsequent change; reconnects automatically (both on AMC's routine ~55-minute
   *  connection rotation and on unexpected drops, the latter with capped backoff). A 404
   *  (live updates disabled server-side) calls `onError` once and stops — this method never
   *  falls back to polling on its own. Returns a function that closes the subscription. */
  watchRunnerStatus(onUpdate: (status: RunnerStatus) => void, onError?: (error: AmcApiError) => void): () => void

  /** Subscribes to live updates for one job over SSE instead of polling `getJob()`. AMC's
   *  job event stream is project-wide, not per-job, so this filters client-side to `jobId`
   *  and re-fetches via `getJob()` on every matching event (and on connect/reconnect) — the
   *  stream itself carries only status/log/metric pointers, never the content. A 401/403/404
   *  from the stream's handshake calls `onError` once and stops; this method never falls back
   *  to polling on its own. Returns a function that closes the subscription. */
  watchJob(jobId: string, onUpdate: (job: Job) => void, onError?: (error: AmcApiError) => void): () => void

  /** Lists Projects visible to this API key (a Project-scoped key sees only its own).
   *  Read-only: a Project API key cannot create or update Projects on any AMC surface
   *  (REST or MCP), so this client has no such method either. */
  listProjects(options?: { status?: 'active' | 'archived' }): Promise<Project[]>
  /** Fetches one Project by id. */
  getProject(projectId: string): Promise<Project>

  /** Lists Agents configured on a Project. Read-only — same Project-API-key
   *  restriction on writes as `listProjects`. */
  listAgents(projectId: string, options?: { status?: 'active' | 'archived' | 'all' }): Promise<Agent[]>
  /** Fetches one Agent by id. */
  getAgent(projectId: string, agentId: string): Promise<Agent>

  /** Lists Batches. Omit `projectId` to use the key's own Project. */
  listBatches(projectId?: string): Promise<Batch[]>
  /** Fetches one Batch, including its job groups and jobs. */
  getBatch(batchId: string): Promise<BatchDetail>
  /** Submits a matrix Batch (prompt/model/etc. combinations against one Agent).
   *  Omit `projectId` to use the key's own Project. */
  submitBatch(input: BatchSubmitInput, projectId?: string): Promise<BatchDetail & { groupCount: number }>

  /** Lists Notes attached to a Project, JobGroup, or Job. */
  listNotes(target: NoteListTarget): Promise<Note[]>
  /** Creates a Note on a Project, JobGroup, or Job. `author` is derived server-side
   *  from the credential — never sent by the client. */
  createNote(target: NoteTarget, body: string): Promise<Note>
  /** Updates a Note's body. */
  updateNote(noteId: string, body: string): Promise<Note>
  /** Deletes a Note. */
  deleteNote(noteId: string): Promise<void>
}

interface JobLogEntry {
  id: string
  jobId: string
  type: string
  content: string
  createdAt: string
}

interface RequestOptions extends RequestInit {
  auth?: boolean
}

const DEFAULT_BASE_URL = 'https://amc.jackwaddington.com'

export function createAmcClient(config: AmcClientConfig): AmcClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL

  async function request<T>(path: string, { auth = false, headers, ...init }: RequestOptions = {}): Promise<T> {
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(headers as Record<string, string> | undefined),
    }
    if (auth) {
      requestHeaders.Authorization = `Bearer ${config.apiKey}`
    }

    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, { ...init, headers: requestHeaders })
    } catch (error) {
      throw new AmcApiError(0, 'Network request failed', error)
    }

    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json') ? await response.json().catch(() => undefined) : undefined

    if (!response.ok) {
      const message = (body as { message?: string } | undefined)?.message ?? response.statusText
      throw new AmcApiError(response.status, message, body)
    }

    return body as T
  }

  async function fetchJob(jobId: string): Promise<Job> {
    const job = await request<Job>(`/api/jobs/${jobId}`, { auth: true })
    if (job.status !== 'complete') {
      return job
    }

    const [logs, metrics] = await Promise.all([
      request<JobLogEntry[]>(`/api/jobs/${jobId}/logs`, { auth: true }),
      request<JobMetric[]>(`/api/jobs/${jobId}/metrics`, { auth: true }),
    ])
    const response = [...logs].reverse().find((entry) => entry.type === 'response')
    const metric = metrics.at(-1)

    return {
      ...job,
      ...(response ? { output: response.content } : {}),
      ...(metric ? { metrics: metric } : {}),
    }
  }

  return {
    submitRaw(model, prompt, systemPrompt) {
      return request<JobGroup>('/api/jobs/raw', {
        method: 'POST',
        auth: true,
        body: JSON.stringify({ model, prompt, systemPrompt }),
      })
    },

    getJob(jobId) {
      return fetchJob(jobId)
    },

    getRunnerStatus() {
      return request<RunnerStatus>('/api/public/runner-status')
    },

    watchRunnerStatus(onUpdate, onError) {
      return openEventStream(
        '/api/public/runner-status/events',
        { baseUrl, apiKey: config.apiKey, auth: false },
        (frame) => {
          if (frame.event === 'runner.status.changed') {
            onUpdate((frame.data as { status: RunnerStatus }).status)
          }
        },
        (err) => onError?.(new AmcApiError(err.status, err.message, err.data)),
      )
    },

    watchJob(jobId, onUpdate, onError) {
      let closed = false
      let refreshing = false
      let refreshAgain = false

      function refresh() {
        if (refreshing) {
          refreshAgain = true
          return
        }
        refreshing = true
        fetchJob(jobId)
          .then((job) => {
            if (!closed) onUpdate(job)
          })
          .catch((err: unknown) => {
            if (closed) return
            onError?.(err instanceof AmcApiError ? err : new AmcApiError(0, 'Failed to refresh job', err))
          })
          .finally(() => {
            refreshing = false
            if (refreshAgain) {
              refreshAgain = false
              refresh()
            }
          })
      }

      const jobEventTypes = new Set(['job.status.changed', 'job.log.appended', 'job.metrics.appended'])

      const stop = openEventStream(
        '/api/events/jobs',
        { baseUrl, apiKey: config.apiKey, auth: true },
        (frame) => {
          if (frame.event === 'stream.ready') {
            refresh()
            return
          }
          if (jobEventTypes.has(frame.event) && (frame.data as { jobId: string }).jobId === jobId) {
            refresh()
          }
        },
        (err) => onError?.(new AmcApiError(err.status, err.message, err.data)),
      )

      return () => {
        closed = true
        stop()
      }
    },

    listProjects(options) {
      const query = options?.status ? `?status=${options.status}` : ''
      return request<Project[]>(`/api/projects${query}`, { auth: true })
    },

    getProject(projectId) {
      return request<Project>(`/api/projects/${projectId}`, { auth: true })
    },

    listAgents(projectId, options) {
      const query = options?.status ? `?status=${options.status}` : ''
      return request<Agent[]>(`/api/projects/${projectId}/agents${query}`, { auth: true })
    },

    getAgent(projectId, agentId) {
      return request<Agent>(`/api/projects/${projectId}/agents/${agentId}`, { auth: true })
    },

    listBatches(projectId) {
      const query = projectId ? `?projectId=${projectId}` : ''
      return request<Batch[]>(`/api/batches${query}`, { auth: true })
    },

    getBatch(batchId) {
      return request<BatchDetail>(`/api/batches/${batchId}`, { auth: true })
    },

    submitBatch(input, projectId) {
      return request<BatchDetail & { groupCount: number }>('/api/batches', {
        method: 'POST',
        auth: true,
        body: JSON.stringify(projectId ? { ...input, projectId } : input),
      })
    },

    listNotes(target) {
      const query = target.level === 'project' && target.scope ? `?scope=${target.scope}` : ''
      const path = noteCollectionPath(target)
      return request<Note[]>(`${path}${query}`, { auth: true })
    },

    createNote(target, body) {
      return request<Note>(noteCollectionPath(target), {
        method: 'POST',
        auth: true,
        body: JSON.stringify({ body }),
      })
    },

    updateNote(noteId, body) {
      return request<Note>(`/api/notes/${noteId}`, {
        method: 'PATCH',
        auth: true,
        body: JSON.stringify({ body }),
      })
    },

    async deleteNote(noteId) {
      await request<void>(`/api/notes/${noteId}`, { method: 'DELETE', auth: true })
    },
  }
}

function noteCollectionPath(target: NoteTarget): string {
  switch (target.level) {
    case 'project':
      return `/api/projects/${target.projectId}/notes`
    case 'group':
      return `/api/job-groups/${target.jobGroupId}/notes`
    case 'job':
      return `/api/jobs/${target.jobId}/notes`
  }
}
