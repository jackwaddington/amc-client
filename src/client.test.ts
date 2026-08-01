import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAmcClient } from './client'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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
    const status = { online: true, queuedJobs: 2, runningJobs: 1 }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(status))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    const result = await amc.getRunnerStatus()

    expect(result).toEqual(status)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.headers).not.toHaveProperty('Authorization')
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

  it('triggerWarmUp silently no-ops when the endpoint does not exist yet (404)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await expect(amc.triggerWarmUp()).resolves.toBeUndefined()
  })

  it('triggerWarmUp silently no-ops on a network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const amc = createAmcClient({ apiKey: 'amc_sk_test', baseUrl: 'https://api.test' })

    await expect(amc.triggerWarmUp()).resolves.toBeUndefined()
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
