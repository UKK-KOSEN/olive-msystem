import { streamProxyToBackend } from '@/lib/stream-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = (req: Request) => streamProxyToBackend(req, '/api/images');

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;