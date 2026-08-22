import { NextRequest, NextResponse } from "next/server";

/**
 * Legacy raster endpoint for achievement art.
 *
 * The achievement catalog stores SVG paths, which React Native's <Image> cannot
 * render, so mobile builds request the PNG twin through this route. It used to
 * rasterize the SVG with sharp at request time by reading
 * `public/achievements/placeholders/*.svg` off the container filesystem — that
 * always 404s in production, because the deployed App Hosting container ships
 * without a `public/` directory (every static asset is served from the GCS
 * bucket via the rewrite in next.config.ts).
 *
 * Pre-rendered PNGs now live alongside the SVGs, so this route just points at
 * them. Current mobile builds request the static path directly; this redirect
 * exists so already-installed builds with the old URL baked in keep working.
 */

function sanitizeImageName(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!/^[a-z0-9_-]+\.png$/i.test(trimmed)) {
    return "";
  }
  return trimmed;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ imageName: string }> },
) {
  const params = await context.params;
  const imageName = sanitizeImageName(params.imageName);
  if (!imageName) {
    return NextResponse.json({ error: "invalid_image_name" }, { status: 400 });
  }

  // A relative Location, not NextResponse.redirect(). Behind Cloud Run the
  // request origin is the container's internal bind address (0.0.0.0:8080),
  // so building an absolute URL from it sends clients somewhere unreachable.
  return new NextResponse(null, {
    status: 308,
    headers: {
      Location: `/achievements/placeholders-png/${imageName}`,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
