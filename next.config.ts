import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Parsers are Node-only; keep them out of the bundler.
  serverExternalPackages: ["unpdf", "mammoth"],
};

export default nextConfig;
