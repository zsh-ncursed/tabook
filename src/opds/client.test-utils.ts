export function mockResponse(
  body: string | Uint8Array,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  const isText = typeof body === 'string';
  const buffer = isText ? new TextEncoder().encode(body) : body;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: init.headers,
  });
}

export function setFetchMock(fn: (...args: unknown[]) => Promise<Response>): void {
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
}
