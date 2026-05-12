/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true,
  },
  serverExternalPackages: ["better-sqlite3", "mqtt"],
};

export default nextConfig;
