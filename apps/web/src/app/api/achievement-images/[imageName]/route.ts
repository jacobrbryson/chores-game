import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

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

  const svgName = imageName.replace(/\.png$/i, ".svg");
  const svgPath = path.join(
    process.cwd(),
    "public",
    "achievements",
    "placeholders",
    svgName,
  );

  try {
    const svgBuffer = await readFile(svgPath);
    const pngBuffer = await sharp(svgBuffer)
      .resize(256, 256, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "image_not_found" }, { status: 404 });
  }
}
