import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'
import path from 'node:path'
export default function nextConfig(phase: string): NextConfig {
  return {
    poweredByHeader: false,
    outputFileTracingRoot: path.resolve(__dirname),
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
  }
}
