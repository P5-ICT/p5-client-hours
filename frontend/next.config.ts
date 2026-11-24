import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // The repo holds two projects. Pin the root so a stray package-lock.json higher up cannot be picked instead.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
