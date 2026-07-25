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
})
