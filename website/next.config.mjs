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
    // Süper-admin paneli ayrı bir Vite deploy'unda (car-launcher-pro). Buradan
    // reverse-proxy'liyoruz → carospro.com/admin/tani gerçek paneli gösterir.
    // admin.html asset'lerini /assets/* kök yolundan yükler; website Next.js
    // kendi asset'lerini /_next altında tutar → /assets çakışmasız, güvenle
    // proxy'lenir (yoksa panel HTML gelir ama JS/CSS 404 → beyaz ekran).
    return [
      {
        source:      '/admin/:path*',
        destination: `${adminUrl}/admin/:path*`,
      },
      {
        source:      '/admin',
        destination: `${adminUrl}/admin`,
      },
      {
        source:      '/assets/:path*',
        destination: `${adminUrl}/assets/:path*`,
      },
    ];
  },
};

export default nextConfig;
