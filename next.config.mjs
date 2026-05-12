/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  serverExternalPackages: ["better-sqlite3", "mqtt"],
};

export default nextConfig;
