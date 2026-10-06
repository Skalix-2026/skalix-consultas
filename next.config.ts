import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "20mb" } }, // upload de agendas PDF/Excel
};

export default nextConfig;
