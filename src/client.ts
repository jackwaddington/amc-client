import type { Job, JobGroup, RunnerStatus, JobMetric } from './types.js'

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
  /** Public, unauthenticated — AMC's runner online/queued/running snapshot. */
  getRunnerStatus(): Promise<RunnerStatus>
  /** Best-effort GPU wake-up nudge. Silently no-ops on any failure (missing endpoint,
   *  network error, etc.) — callers should never need to handle this rejecting. */
  triggerWarmUp(): Promise<void>
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

  return {
    submitRaw(model, prompt, systemPrompt) {
      return request<JobGroup>('/api/jobs/raw', {
        method: 'POST',
        auth: true,
        body: JSON.stringify({ model, prompt, systemPrompt }),
      })
    },

    async getJob(jobId) {
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
    },

    getRunnerStatus() {
      return request<RunnerStatus>('/api/public/runner-status')
    },

    async triggerWarmUp() {
      try {
        await request('/api/public/warm-up', { method: 'POST' })
      } catch {
        // Best-effort only: missing endpoint, network failure, etc. are all fine to ignore.
      }
    },
  }
}
