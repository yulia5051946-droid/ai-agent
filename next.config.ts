import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  allowedDevOrigins: ['garenabdcontract.run.ingarena.net'],
  turbopack: {
    root: process.cwd(),
  },
}

export default nextConfig
