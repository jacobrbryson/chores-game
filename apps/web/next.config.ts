import type { NextConfig } from "next";

const gcsAssetBaseUrl = process.env.NEXT_PUBLIC_GCS_ASSET_BASE_URL?.replace(/\/+$/, "");

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
  async rewrites() {
    if (!gcsAssetBaseUrl) {
      return [];
    }

    return {
      beforeFiles: [
        {
          source:
            "/:path((?!api/|_next/|.*\\..*\\/).+\\.(?:png|jpg|jpeg|webp|gif|svg|ico|mp3|json|webmanifest|js))",
          destination: `${gcsAssetBaseUrl}/:path`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
