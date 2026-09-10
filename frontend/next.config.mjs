/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // /versions was merged into /algorithm — keep old bookmarks working.
    return [
      { source: '/versions', destination: '/algorithm', permanent: true },
    ];
  },
  async rewrites() {
    // Proxy API + storage calls to the FastAPI backend so the browser only
    // ever talks to the same origin (avoids CORS entirely in production).
    const apiHost = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
    return [
      { source: '/api/:path*', destination: `${apiHost}/api/:path*` },
      { source: '/storage/:path*', destination: `${apiHost}/storage/:path*` },
    ];
  },
};

export default nextConfig;
