/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces a minimal server bundle in .next/standalone, which is what the
  // Dockerfile runner stage copies. Keeps the production image small and
  // avoids shipping dev dependencies.
  output: 'standalone',
};

export default nextConfig;
