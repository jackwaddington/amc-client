import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAmcClient } from './client'
import { controlledSseResponse, frame, sseResponse } from './sseHelpers'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Real (unmocked) macrotask tick — lets any pending microtask chain (stream reads,
// fetch mocks, .then/.finally) settle before assertions, without needing fake timers.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createAmcClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits one raw call (model + prompt + systemPrompt) with the bearer token', async () => {
    const group = { id: 'group-1', status: 'approved', jobs: [{ id: 'job-1', status: 'approved' }] }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(group, 202))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.submitRaw('llama3.2:latest', 'Fire at Main St', 'You are a dispatcher.')

    expect(result).toEqual(group)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.test/api/jobs/raw')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer amc_sk_test' })
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'llama3.2:latest',
      prompt: 'Fire at Main St',
      systemPrompt: 'You are a dispatcher.',
    })
  })

  it('forwards an optional tag on submitRaw', async () => {
    const group = { id: 'group-1', status: 'approved', tag: 'session-a', jobs: [{ id: 'job-1', status: 'approved' }] }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(group))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await amc.submitRaw('llama3.2:latest', 'Fire at Main St', 'You are a dispatcher.', { tag: 'session-a' })

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      model: 'llama3.2:latest',
      prompt: 'Fire at Main St',
      systemPrompt: 'You are a dispatcher.',
      tag: 'session-a',
    })
  })

  it('forwards Ollama sampling options (temperatures sweep, topK, topP, repeatPenalty, numPredict, mirostat) on submitRaw', async () => {
    const group = { id: 'group-1', status: 'approved', jobs: [{ id: 'job-1', status: 'approved' }] }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(group))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await amc.submitRaw('llama3.2:latest', 'Fire at Main St', 'You are a dispatcher.', {
      temperatures: [0.2, 0.7],
      topK: 40,
      topP: 0.9,
      repeatPenalty: 1.1,
      numPredict: 256,
      mirostat: 2,
    })

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      model: 'llama3.2:latest',
      prompt: 'Fire at Main St',
      systemPrompt: 'You are a dispatcher.',
      temperatures: [0.2, 0.7],
      topK: 40,
      topP: 0.9,
      repeatPenalty: 1.1,
      numPredict: 256,
      mirostat: 2,
    })
  })

  it('submits a job to an Agent with type:"agentic" so its tool-calling loop actually runs', async () => {
    const group = { id: 'group-1', status: 'approved', jobs: [{ id: 'job-1', status: 'approved' }] }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(group, 202))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.submitJob('agent-1', 'Dundee Science Centre')

    expect(result).toEqual(group)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.test/api/jobs')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer amc_sk_test' })
    expect(JSON.parse(init?.body as string)).toEqual({
      agentId: 'agent-1',
      prompt: 'Dundee Science Centre',
      type: 'agentic',
    })
  })

  it('forwards optional tag and name on submitJob', async () => {
    const group = { id: 'group-1', status: 'approved', tag: 'session-a', jobs: [{ id: 'job-1', status: 'approved' }] }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(group, 202))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await amc.submitJob('agent-1', 'Dundee Science Centre', { tag: 'session-a', name: 'search-1' })

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      agentId: 'agent-1',
      prompt: 'Dundee Science Centre',
      type: 'agentic',
      tag: 'session-a',
      name: 'search-1',
    })
  })

  it('defaults baseUrl to https://amc.jackwaddington.com when not given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ online: true, queuedJobs: 0, runningJobs: 0 }))
    const amc = createAmcClient({ apiKey: 'amc_sk_test' })

    await amc.getRunnerStatus()

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://amc.jackwaddington.com/api/public/runner-status')
  })

  it('fetches a job by id and does not fetch logs while still running', async () => {
    const job = { id: 'job-1', status: 'running' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(job))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getJob('job-1')

    expect(result).toEqual(job)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/api/jobs/job-1')
  })

  it('merges the response log content into `output` once a job is complete', async () => {
    const job = { id: 'job-1', status: 'complete' }
    const logs = [
      { id: 'log-1', jobId: 'job-1', type: 'prompt', content: 'Fire at Main St', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'log-2', jobId: 'job-1', type: 'response', content: 'Dispatch plan drafted.', createdAt: '2026-01-01T00:00:05Z' },
    ]
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(job))
      .mockResolvedValueOnce(jsonResponse(logs))
      .mockResolvedValueOnce(jsonResponse([]))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getJob('job-1')

    expect(result).toEqual({ ...job, output: 'Dispatch plan drafted.' })
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('https://api.test/api/jobs/job-1/logs')
  })

  it('leaves output unset if a completed job has no response log', async () => {
    const job = { id: 'job-1', status: 'complete' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(job))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getJob('job-1')

    expect(result).toEqual(job)
  })

  it('merges the last metrics entry into `metrics` once a job is complete', async () => {
    const job = { id: 'job-1', status: 'complete' }
    const metric = {
      model: 'llama3.2:latest',
      totalDurationNs: 1187945902,
      loadDurationNs: 1116870507,
      promptEvalCount: 122,
      promptEvalDurationNs: 21869092,
      evalCount: 8,
      evalDurationNs: 42055717,
      doneReason: 'stop',
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(job))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([metric]))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getJob('job-1')

    expect(result.metrics).toEqual(metric)
    expect(vi.mocked(fetch).mock.calls[2][0]).toBe('https://api.test/api/jobs/job-1/metrics')
  })

  it('leaves metrics unset if a completed job has none recorded yet', async () => {
    const job = { id: 'job-1', status: 'complete' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(job))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getJob('job-1')

    expect(result.metrics).toBeUndefined()
  })

  it('fetches public runner status without an auth header', async () => {
    const status = {
      online: true,
      state: 'busy',
      queuedJobs: 2,
      runningJobs: 1,
      gpuName: 'RTX 5060 Ti',
      vramMb: 16_384,
      defaultModel: 'qwen2.5:7b',
      models: [],
      runners: [{
        runnerId: 'gpu-01',
        state: 'busy',
        wakeable: true,
        warmModel: 'qwen2.5:7b',
        gpuName: 'RTX 5060 Ti',
        vramMb: 16_384,
        lastHeartbeatAt: '2026-08-01T10:00:00.000Z',
      }],
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(status))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getRunnerStatus()

    // The type used to declare only online/queuedJobs/runningJobs while the API
    // returned all of this, so callers could not reach it without casting.
    expect(result).toEqual(status)
    expect(result.state).toBe('busy')
    expect(result.runners[0]!.wakeable).toBe(true)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.headers).not.toHaveProperty('Authorization')
  })

  describe('watchRunnerStatus', () => {
    it('subscribes without an Authorization header and delivers each snapshot, but not stream.ready itself', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        sseResponse([
          frame('stream.ready', { stream: 'runner' }),
          frame('runner.status.changed', { status: { online: true, state: 'idle' } }),
        ]),
      )
      const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })
      const updates: unknown[] = []
      const close = amc.watchRunnerStatus((status) => updates.push(status))

      const [url, init] = vi.mocked(fetch).mock.calls[0]!
      expect(url).toBe('https://api.test/api/public/runner-status/events')
      expect(init?.headers).not.toHaveProperty('Authorization')

      await flush()
      expect(updates).toEqual([{ online: true, state: 'idle' }])
      close()
    })
  })

  describe('watchJob', () => {
    it('subscribes with a bearer token and proactively fetches the job on connect', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(sseResponse([frame('stream.ready')]))
        .mockResolvedValueOnce(jsonResponse({ id: 'job-1', status: 'running' }))
      const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })
      const updates: unknown[] = []
      const close = amc.watchJob('job-1', (job) => updates.push(job))

      const [url, init] = vi.mocked(fetch).mock.calls[0]!
      expect(url).toBe('https://api.test/api/events/jobs')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer amc_sk_test' })

      await flush()
      expect(vi.mocked(fetch).mock.calls[1]![0]).toBe('https://api.test/api/jobs/job-1')
      expect(updates).toEqual([{ id: 'job-1', status: 'running' }])
      close()
    })

    it('ignores events for a different jobId', async () => {
      const c = controlledSseResponse()
      vi.mocked(fetch)
        .mockResolvedValueOnce(c.response)
        .mockResolvedValueOnce(jsonResponse({ id: 'job-1', status: 'running' })) // proactive, on connect
      const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })
      const updates: unknown[] = []
      const close = amc.watchJob('job-1', (job) => updates.push(job))

      c.push(frame('stream.ready'))
      await flush()
      expect(updates).toHaveLength(1)

      c.push(frame('job.status.changed', { jobId: 'job-2', patch: { status: 'complete' } }))
      await flush()
      expect(updates).toHaveLength(1)
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2) // no extra fetch for the other job

      close()
    })

    it.each(['job.status.changed', 'job.log.appended', 'job.metrics.appended'])(
      'refetches the job on a matching %s event',
      async (eventType) => {
        const c = controlledSseResponse()
        vi.mocked(fetch)
          .mockResolvedValueOnce(c.response)
          .mockResolvedValueOnce(jsonResponse({ id: 'job-1', status: 'running' })) // proactive, on connect
          .mockResolvedValueOnce(jsonResponse({ id: 'job-1', status: 'running', agentName: 'demo-agent' }))
        const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })
        const updates: unknown[] = []
        const close = amc.watchJob('job-1', (job) => updates.push(job))

        c.push(frame('stream.ready'))
        await flush()
        expect(updates).toHaveLength(1)

        c.push(frame(eventType, { jobId: 'job-1' }))
        await flush()
        expect(updates).toHaveLength(2)
        expect(updates[1]).toEqual({ id: 'job-1', status: 'running', agentName: 'demo-agent' })
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)

        close()
      },
    )

    it('coalesces a burst of matching events into fewer getJob fetches than events', async () => {
      const c = controlledSseResponse()
      let resolveProactiveFetch!: (r: Response) => void
      const proactiveFetch = new Promise<Response>((resolve) => {
        resolveProactiveFetch = resolve
      })

      vi.mocked(fetch)
        .mockResolvedValueOnce(c.response)
        .mockImplementationOnce(() => proactiveFetch)
        .mockResolvedValueOnce(jsonResponse({ id: 'job-1', status: 'running', agentName: 'demo-agent' }))

      const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })
      const updates: unknown[] = []
      const close = amc.watchJob('job-1', (job) => updates.push(job))

      c.push(frame('stream.ready'))
      await flush()

      c.push(frame('job.status.changed', { jobId: 'job-1', patch: { status: 'running' } }))
      c.push(frame('job.log.appended', { jobId: 'job-1', logId: 'log-1' }))
      c.push(frame('job.metrics.appended', { jobId: 'job-1', metricId: 'metric-1' }))
      await flush()

      // The proactive fetch is still in flight; none of the three burst events have
      // triggered a new fetch yet — they coalesce onto a single trailing refresh.
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)

      resolveProactiveFetch(jsonResponse({ id: 'job-1', status: 'running' }))
      await flush()

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
      expect(updates.at(-1)).toEqual({ id: 'job-1', status: 'running', agentName: 'demo-agent' })

      close()
    })

    it('close() stops delivering further updates', async () => {
      const c = controlledSseResponse()
      vi.mocked(fetch)
        .mockImplementationOnce((_url, init) => {
          init?.signal?.addEventListener('abort', () => c.error())
          return Promise.resolve(c.response)
        })
        .mockResolvedValueOnce(jsonResponse({ id: 'job-1', status: 'running' }))
      const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })
      const updates: unknown[] = []
      const close = amc.watchJob('job-1', (job) => updates.push(job))

      c.push(frame('stream.ready'))
      await flush()
      expect(updates).toHaveLength(1)

      close()
      await flush()

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2) // no reconnect, no further getJob fetch
      expect(updates).toHaveLength(1)
    })
  })

  it('throws an AmcApiError carrying status and parsed body on a non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Daily limit reached' }, 429))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await expect(amc.submitRaw('llama3.2:latest', 'test', 'sys')).rejects.toMatchObject({
      name: 'AmcApiError',
      status: 429,
      message: 'Daily limit reached',
    })
  })

  it('wraps network failures in an AmcApiError with status 0', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await expect(amc.getRunnerStatus()).rejects.toMatchObject({ name: 'AmcApiError', status: 0 })
  })

  it('lists projects with an optional status filter', async () => {
    const projects = [{ id: 'project-1', name: 'Dispatch Demo' }]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(projects))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.listProjects({ status: 'archived' })

    expect(result).toEqual(projects)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.test/api/projects?status=archived')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer amc_sk_test' })
  })

  it('lists projects with no query string when no status is given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await amc.listProjects()

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/api/projects')
  })

  it('fetches one project by id', async () => {
    const project = { id: 'project-1', name: 'Dispatch Demo' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(project))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getProject('project-1')

    expect(result).toEqual(project)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/api/projects/project-1')
  })

  it('lists agents for a project with an optional status filter', async () => {
    const agents = [{ id: 'agent-1', name: 'Dispatcher' }]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(agents))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.listAgents('project-1', { status: 'all' })

    expect(result).toEqual(agents)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/api/projects/project-1/agents?status=all')
  })

  it('fetches one agent by id', async () => {
    const agent = { id: 'agent-1', name: 'Dispatcher' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(agent))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getAgent('project-1', 'agent-1')

    expect(result).toEqual(agent)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/api/projects/project-1/agents/agent-1')
  })

  it('lists batches, optionally scoped to a project', async () => {
    const batches = [{ id: 'batch-1', status: 'complete' }]
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(batches))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.listBatches('project-1')

    expect(result).toEqual(batches)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/api/batches?projectId=project-1')
  })

  it('fetches one batch by id', async () => {
    const batch = { id: 'batch-1', status: 'complete', groups: [] }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(batch))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getBatch('batch-1')

    expect(result).toEqual(batch)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/api/batches/batch-1')
  })

  it('submits a batch, including projectId in the body only when given', async () => {
    const input = { promptIds: ['prompt-1'], modelIds: ['llama3.2:latest'], agentId: 'agent-1' }
    const batch = { id: 'batch-1', groupCount: 1 }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(batch, 201))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.submitBatch(input, 'project-1')

    expect(result).toEqual(batch)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.test/api/batches')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ ...input, projectId: 'project-1' })
  })

  it('submits a batch without a projectId field when none is given', async () => {
    const input = { promptIds: ['prompt-1'], modelIds: ['llama3.2:latest'], agentId: 'agent-1' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: 'batch-1', groupCount: 1 }, 201))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await amc.submitBatch(input)

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(init?.body as string)).toEqual(input)
  })

  it.each([
    [{ level: 'project' as const, projectId: 'project-1' }, 'https://api.test/api/projects/project-1/notes'],
    [{ level: 'group' as const, jobGroupId: 'group-1' }, 'https://api.test/api/job-groups/group-1/notes'],
    [{ level: 'job' as const, jobId: 'job-1' }, 'https://api.test/api/jobs/job-1/notes'],
  ])('lists notes for target %o at the right route', async (target, expectedUrl) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await amc.listNotes(target)

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(expectedUrl)
  })

  it('appends a scope query param only for project-level note listings', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await amc.listNotes({ level: 'project', projectId: 'project-1', scope: 'all' })

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/api/projects/project-1/notes?scope=all')
  })

  it.each([
    [{ level: 'project' as const, projectId: 'project-1' }, 'https://api.test/api/projects/project-1/notes'],
    [{ level: 'group' as const, jobGroupId: 'group-1' }, 'https://api.test/api/job-groups/group-1/notes'],
    [{ level: 'job' as const, jobId: 'job-1' }, 'https://api.test/api/jobs/job-1/notes'],
  ])('creates a note for target %o at the right route, sending only the body', async (target, expectedUrl) => {
    const note = { id: 'note-1', body: 'Called back, no answer.' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(note, 201))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.createNote(target, 'Called back, no answer.')

    expect(result).toEqual(note)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(expectedUrl)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ body: 'Called back, no answer.' })
  })

  it('updates a note by id', async () => {
    const note = { id: 'note-1', body: 'Updated.' }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(note))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.updateNote('note-1', 'Updated.')

    expect(result).toEqual(note)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.test/api/notes/note-1')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ body: 'Updated.' })
  })

  it('deletes a note by id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await expect(amc.deleteNote('note-1')).resolves.toBeUndefined()

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.test/api/notes/note-1')
    expect(init?.method).toBe('DELETE')
  })
})
