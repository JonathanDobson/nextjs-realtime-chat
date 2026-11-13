import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // A self-contained server.js + minimal node_modules for the Docker image.
  // docs: libraries/nextjs/16.4.5/content/01-app/api-reference/05-config/01-next-config-js/output.mdx
  output: 'standalone',
}

export default nextConfig
