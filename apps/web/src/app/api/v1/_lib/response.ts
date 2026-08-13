import { NextRequest, NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

export function resolveInternalProxyUrl(
  requestUrl: string,
  path: string,
  port = process.env.PORT,
) {
  const normalizedPort = port?.trim() ?? "";
  const portNumber = Number(normalizedPort);
  const hasValidPort =
    /^\d+$/.test(normalizedPort) &&
    Number.isInteger(portNumber) &&
    portNumber >= 1 &&
    portNumber <= 65_535;

  // Cloud Run terminates TLS before forwarding requests to the Next.js server.
  // Next.js can therefore expose an https request URL containing the container's
  // internal HTTP port. Calling that URL directly fails with
  // ERR_SSL_WRONG_VERSION_NUMBER, so server-side v1 proxies use loopback HTTP.
  const baseUrl = hasValidPort ? `http://127.0.0.1:${portNumber}` : requestUrl;
  return new URL(path, baseUrl);
}

export async function proxyJson(request: NextRequest, path: string, init?: RequestInit) {
  const url = resolveInternalProxyUrl(request.url, path);
  const method = init?.method ?? request.method;
  // Prefer an explicit body from the caller. Only read the incoming request
  // stream when no body was supplied — reading it here after the caller has
  // already consumed it (e.g. via request.json()) throws "Body has already
  // been read".
  const body = method === "GET" ? undefined : (init?.body ?? (await request.text()));
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
    },
    body,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Like proxyJson, but also surfaces any Set-Cookie headers the upstream route
// emitted. Used by routes that rotate the `session_user` cookie (e.g. account
// switching) so the mobile client receives the new session cookie.
export async function proxyJsonWithCookies(request: NextRequest, path: string, init?: RequestInit) {
  const url = resolveInternalProxyUrl(request.url, path);
  const method = init?.method ?? request.method;
  // See proxyJson: prefer an explicit caller body; only read the request stream
  // when none was supplied, to avoid double-reading an already-consumed body.
  const body = method === "GET" ? undefined : (init?.body ?? (await request.text()));
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
    },
    body,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = typeof getSetCookie === "function"
    ? getSetCookie.call(res.headers)
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
  return { status: res.status, json, setCookies };
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
