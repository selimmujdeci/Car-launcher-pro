/** @type {import('next').NextConfig} */
const nextConfig = {
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
