import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openEventStream } from './sseStream'
import { controlledSseResponse, frame, heartbeat, sseResponse } from './sseHelpers'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('openEventStream', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
    // Removes jitter (multiplier becomes exactly 1) so backoff-timing assertions are exact.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('connects immediately with Accept: text/event-stream and no Authorization when auth is not requested', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(sseResponse([]))
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'secret', auth: false }, () => {}, () => {})

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://api.test/x')
    expect(init?.headers).toMatchObject({ Accept: 'text/event-stream' })
    expect(init?.headers).not.toHaveProperty('Authorization')
  })

  it('sends a bearer token when auth is requested', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(sseResponse([]))
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'secret', auth: true }, () => {}, () => {})

    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' })
  })

  it('parses id/event/data and delivers frames in order', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse([
        frame('stream.ready', { stream: 'runner' }),
        frame('runner.status.changed', { online: true }, '42'),
      ]),
    )
    const events: unknown[] = []
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, (f) => events.push(f), () => {})
    await vi.advanceTimersByTimeAsync(0)

    expect(events).toEqual([
      { id: undefined, event: 'stream.ready', data: { stream: 'runner' } },
      { id: '42', event: 'runner.status.changed', data: { online: true } },
    ])
  })

  it('delivers heartbeats silently and forwards each subsequent real event', async () => {
    const c = controlledSseResponse()
    vi.mocked(fetch).mockResolvedValueOnce(c.response)
    const events: unknown[] = []
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, (f) => events.push(f), () => {})
    await vi.advanceTimersByTimeAsync(0)

    c.push(frame('stream.ready'))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(1)

    c.push(heartbeat)
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(1) // no event for the heartbeat

    c.push(frame('runner.status.changed', { online: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ event: 'runner.status.changed', data: { online: true } })
  })

  it('buffers a frame split across multiple chunks and parses it once fully received', async () => {
    const c = controlledSseResponse()
    vi.mocked(fetch).mockResolvedValueOnce(c.response)
    const events: unknown[] = []
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, (f) => events.push(f), () => {})
    await vi.advanceTimersByTimeAsync(0)

    const full = frame('runner.status.changed', { online: true })
    const splitAt = Math.floor(full.length / 2)
    c.push(full.slice(0, splitAt))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(0)

    c.push(full.slice(splitAt))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: 'runner.status.changed', data: { online: true } })
  })

  it('reconnects only after the backoff delay on an unexpected drop, and escalates through the table', async () => {
    const f = vi.mocked(fetch)
    f.mockRejectedValueOnce(new TypeError('fail 1'))
    f.mockRejectedValueOnce(new TypeError('fail 2'))
    const c = controlledSseResponse()
    f.mockResolvedValueOnce(c.response)

    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, () => {}, () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(2) // first backoff tier: 1000ms

    await vi.advanceTimersByTimeAsync(1999)
    expect(f).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(3) // second backoff tier: 2000ms — now connected

    // A successful connect resets the counter — the next unexpected drop backs off from
    // the base tier again, not from where the escalation left off.
    c.end()
    await vi.advanceTimersByTimeAsync(0)
    f.mockRejectedValueOnce(new TypeError('fail after reset'))
    await vi.advanceTimersByTimeAsync(999)
    expect(f).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(4)
  })

  it('reconnects immediately on stream.rotate, without backoff, and never forwards it to onEvent', async () => {
    const f = vi.mocked(fetch)
    f.mockResolvedValueOnce(
      sseResponse([frame('stream.ready'), frame('stream.rotate', { reason: 'connection_lifetime' })]),
    )
    f.mockResolvedValueOnce(sseResponse([frame('stream.ready')]))
    const events: string[] = []
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, (fr) => events.push(fr.event), () => {})
    await vi.advanceTimersByTimeAsync(0)

    expect(f).toHaveBeenCalledTimes(2)
    expect(events).toEqual(['stream.ready', 'stream.ready'])
  })

  it('close() aborts the in-flight connection and stops delivering further events', async () => {
    const c = controlledSseResponse()
    vi.mocked(fetch).mockImplementationOnce((_url, init) => {
      init?.signal?.addEventListener('abort', () => c.error())
      return Promise.resolve(c.response)
    })
    const events: string[] = []
    const close = openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, (fr) => events.push(fr.event), () => {})
    await vi.advanceTimersByTimeAsync(0)

    c.push(frame('stream.ready'))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual(['stream.ready'])

    close()
    await vi.advanceTimersByTimeAsync(0)

    // Nothing further is delivered even well past every backoff tier — the subscription
    // is fully torn down, not just paused.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(events).toEqual(['stream.ready'])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('close() during a pending backoff cancels the reconnect entirely', async () => {
    const f = vi.mocked(fetch)
    f.mockRejectedValueOnce(new TypeError('fail'))
    const close = openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, () => {}, () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)

    close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('404 on initial connect calls onError once and never retries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Live updates are disabled' }, 404))
    const errors: unknown[] = []
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, () => {}, (e) => errors.push(e))
    await vi.advanceTimersByTimeAsync(0)

    expect(errors).toEqual([
      { status: 404, message: 'Live updates are disabled', data: { message: 'Live updates are disabled' } },
    ])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(errors).toHaveLength(1)
  })

  it.each([401, 403])('%i on initial connect calls onError once and never retries', async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'nope' }, status))
    const errors: unknown[] = []
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, () => {}, (e) => errors.push(e))
    await vi.advanceTimersByTimeAsync(0)

    expect(errors).toEqual([{ status, message: 'nope', data: { message: 'nope' } }])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('5xx on initial connect is treated as transient and retried with backoff, not surfaced as onError', async () => {
    const f = vi.mocked(fetch)
    f.mockResolvedValueOnce(jsonResponse({ message: 'oops' }, 500))
    f.mockResolvedValueOnce(sseResponse([frame('stream.ready')]))
    const errors: unknown[] = []
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, () => {}, (e) => errors.push(e))
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    expect(errors).toEqual([])

    await vi.advanceTimersByTimeAsync(999)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(2)
    expect(errors).toEqual([])
  })

  it('a rejected fetch (network failure) is retried with backoff, same as a mid-stream drop', async () => {
    const f = vi.mocked(fetch)
    f.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    f.mockResolvedValueOnce(sseResponse([frame('stream.ready')]))
    openEventStream('/x', { baseUrl: 'https://api.test', apiKey: 'k' }, () => {}, () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(2)
  })
})
