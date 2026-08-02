export interface StreamFrame {
  id?: string
  event: string
  data: unknown
}

export interface StreamConnectError {
  status: number
  message: string
  data: unknown
}

export interface OpenEventStreamOptions {
  baseUrl: string
  apiKey: string
  auth?: boolean
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000]

// Hand-rolled instead of pulling in a dependency (this package has zero
// runtime deps by design) — the server's wire format is simple enough not to
// need one: `id: <n>\nevent: <type>\ndata: <json>\n\n` per event, bare
// `: heartbeat\n\n` comment lines, and never a multi-line `data:` field.
export function openEventStream(
  path: string,
  options: OpenEventStreamOptions,
  onEvent: (frame: StreamFrame) => void,
  onError: (error: StreamConnectError) => void,
): () => void {
  const closeController = new AbortController()
  let closed = false
  let failureCount = 0

  function close() {
    if (closed) return
    closed = true
    closeController.abort()
  }

  void connectLoop()
  return close

  async function connectLoop() {
    while (!closed) {
      let response: Response
      try {
        response = await fetch(`${options.baseUrl}${path}`, {
          headers: buildHeaders(),
          signal: closeController.signal,
        })
      } catch {
        if (closed) return
        await backoffWait()
        continue
      }

      if (!response.ok) {
        const body = await readJsonBody(response)
        // 404/401/403 are standing conditions (feature disabled, bad/revoked
        // key) — retrying them would spin forever. Anything else (5xx) is
        // treated as a transient blip, same as a network failure.
        if (response.status === 404 || response.status === 401 || response.status === 403) {
          const message = (body as { message?: string } | undefined)?.message ?? response.statusText
          onError({ status: response.status, message, data: body })
          return
        }
        if (closed) return
        await backoffWait()
        continue
      }

      failureCount = 0
      const result = await pump(response, closeController.signal, onEvent)
      if (closed) return
      if (!result.expected) await backoffWait()
      // expected (stream.rotate) loops immediately, no backoff
    }
  }

  async function backoffWait() {
    const base = BACKOFF_MS[Math.min(failureCount, BACKOFF_MS.length - 1)]!
    failureCount++
    const delay = base + (Math.random() * 2 - 1) * base * 0.2
    await sleep(delay, closeController.signal)
  }

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    if (options.auth) headers.Authorization = `Bearer ${options.apiKey}`
    return headers
  }
}

async function pump(
  response: Response,
  signal: AbortSignal,
  onEvent: (frame: StreamFrame) => void,
): Promise<{ expected: boolean }> {
  if (!response.body) return { expected: false }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return { expected: false } // server hung up without stream.rotate
      buffer += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const frame = parseFrame(raw)
        if (!frame) continue // heartbeat/comment-only frame
        if (frame.event === 'stream.rotate') {
          await reader.cancel().catch(() => {})
          return { expected: true }
        }
        onEvent(frame)
      }
    }
  } catch {
    // Network error mid-stream, or our own close() tore the reader down.
    return { expected: signal.aborted }
  }
}

function parseFrame(raw: string): StreamFrame | null {
  let id: string | undefined
  let event: string | undefined
  let dataLine: string | undefined
  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue // blank / comment (heartbeat)
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLine = line.slice(5).trim()
  }
  if (!event) return null
  return { id, event, data: dataLine !== undefined ? JSON.parse(dataLine) : undefined }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

async function readJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json') ? await response.json().catch(() => undefined) : undefined
}
