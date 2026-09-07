import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default server action body limit (1MB) is too small for an
    // uploaded image sent as multipart form data -- documentActions.ts
    // enforces the real per-file cap (5MB) itself; this just needs to be
    // large enough to not reject the request before that check runs.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
