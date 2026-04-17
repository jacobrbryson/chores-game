function normalizeOrigin(value: string) {
  return value.trim().replace(/\/$/, "");
}

export function getCanonicalAppOrigin() {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || "";
  const normalized = normalizeOrigin(configured);
  if (!normalized) {
    throw new Error("APP_ORIGIN_MISSING");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("APP_ORIGIN_INVALID");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("APP_ORIGIN_INVALID");
  }

  return parsed.origin;
}

