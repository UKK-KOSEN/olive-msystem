// Next.js's rewrites() proxy buffers request bodies and stalls on large
// uploads (~10MB+ on 15.5.x), so big endpoints are proxied by streaming here.
const BACKEND_URL = () => process.env.BACKEND_URL || 'http://127.0.0.1:8000';

const STRIP_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
  'expect',
]);

const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

export async function streamProxyToBackend(req: Request, pathname: string): Promise<Response> {
  const incoming = new URL(req.url);
  const target = `${BACKEND_URL()}${pathname}${incoming.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? (req.body as unknown as BodyInit) : undefined,
      duplex: 'half',
      cache: 'no-store',
      redirect: 'manual',
    } as RequestInit & { duplex: 'half' });
  } catch (err) {
    const parts: string[] = [];
    let current: unknown = err;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      const e = current as { message?: string; code?: string; name?: string };
      parts.push(`${e.name ?? 'Error'}: ${e.message ?? String(current)}${e.code ? ` (${e.code})` : ''}`);
      current = (current as { cause?: unknown }).cause;
    }
    return new Response(
      JSON.stringify({
        detail: {
          code: 'PROXY_UPSTREAM_UNAVAILABLE',
          message: `backend unreachable -> ${parts.join(' <- ')}`,
        },
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}