import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Prevent Next image optimizer cache from serving stale local assets
    // when files are replaced at the same URL during active development.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/store3/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/avatars/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
