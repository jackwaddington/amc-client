export function frame(event: string, data?: unknown, id?: string): string {
  const lines: string[] = []
  if (id) lines.push(`id: ${id}`)
  lines.push(`event: ${event}`)
  if (data !== undefined) lines.push(`data: ${JSON.stringify(data)}`)
  return lines.join('\n') + '\n\n'
}

export const heartbeat = ': heartbeat\n\n'

export function sseResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } })
}

export function controlledSseResponse() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
  })
  const response = new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  return {
    response,
    push: (f: string) => ctrl.enqueue(encoder.encode(f)),
    error: () => ctrl.error(new Error('simulated drop')),
    end: () => ctrl.close(),
  }
}
