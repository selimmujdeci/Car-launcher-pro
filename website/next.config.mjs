/** @type {import('next').NextConfig} */
const nextConfig = {
  // msedge-tts + ws'i webpack bundle'ından hariç tut: bundle edilince ws'in
  // native masking'i bozuluyor ("t.mask is not a function", saha 2026-07-03).
  // External → Vercel Node runtime node_modules'tan doğrudan yükler.
  // Next 14.2 → experimental altında (15'te top-level serverExternalPackages).
  experimental: {
    serverComponentsExternalPackages: ['msedge-tts', 'ws'],
  },
  async rewrites() {
    const adminUrl = process.env.ADMIN_APP_URL;
    if (!adminUrl) return [];
    return [
      {
        source:      '/admin/:path*',
        destination: `${adminUrl}/admin/:path*`,
      },
      {
        source:      '/admin',
        destination: `${adminUrl}/admin`,
      },
    ];
  },
};

export default nextConfig;
