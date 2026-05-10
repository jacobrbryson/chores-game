import { NextRequest, NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

export async function proxyJson(request: NextRequest, path: string, init?: RequestInit) {
  const url = new URL(path, request.url);
  const method = init?.method ?? request.method;
  const body = method === "GET" ? undefined : await request.text();
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
    },
    body: body || init?.body,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export function toPaginated<T>(data: T[], fallbackPage = 1, fallbackPageSize = 50) {
  return {
    items: data,
    pagination: {
      page: fallbackPage,
      pageSize: fallbackPageSize,
      total: data.length,
      totalPages: 1,
    },
  };
}
