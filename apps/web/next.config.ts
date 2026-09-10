import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The runner stage copies .next/standalone, so the image carries only the
  // server and the modules it actually imports (spec 002 § 5).
  output: 'standalone',
  outputFileTracingRoot: `${__dirname}/../..`,
  reactStrictMode: true,
};

export default nextConfig;
