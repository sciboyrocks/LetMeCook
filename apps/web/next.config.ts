import type { NextConfig } from "next";
import path from "path";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  allowedDevOrigins: ["*"],
  // Turbopack: fix CSS `@import "tailwindcss"` resolution in pnpm workspaces.
  // Turbopack resolves CSS imports starting from the monorepo apps/ directory,
  // missing apps/web/node_modules. This alias pins it to the correct local path.
  turbopack: {
    resolveAlias: {
      tailwindcss: path.resolve(__dirname, "node_modules/tailwindcss"),
    },
  },
  async rewrites() {
    return [
      // Proxy all /api/* requests to the Fastify API
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
      // Proxy /open/* (code-server redirects)
      {
        source: "/open/:path*",
        destination: `${API_URL}/open/:path*`,
      },
      // Proxy code-server routes through the API reverse proxy
      {
        source: "/code/:path*",
        destination: `${API_URL}/code/:path*`,
      },
      {
        source: "/stable-:path",
        destination: `${API_URL}/stable-:path`,
      },
      {
        source: "/vscode-remote-resource/:path*",
        destination: `${API_URL}/vscode-remote-resource/:path*`,
      },
      {
        source: "/_static/:path*",
        destination: `${API_URL}/_static/:path*`,
      },
      {
        source: "/out/:path*",
        destination: `${API_URL}/out/:path*`,
      },
    ];
  },
};

export default nextConfig;
